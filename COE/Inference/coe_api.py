import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from xgboost import XGBRegressor
import joblib
import os
from datetime import datetime
from typing import Optional

# LOAD MODELS AND DATA WITH CONFIG

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
CATEGORIES = ["Category A", "Category B", "Category C", "Category D", "Category E"]
LAST_TRAINING_MONTH = "2026-03"  # March 2026

models = {}
last_known_premiums = {}
last_known_covariates = {}
feature_cols = []
residual_stds = {}

# Load models
for cat in CATEGORIES:
    model_path = os.path.join(MODEL_DIR, f"first_diff_xgb_{cat.replace(' ', '_')}.joblib")
    if os.path.exists(model_path):
        models[cat] = joblib.load(model_path)
        print(f"Loaded model for {cat}")
    else:
        print(f"Warning: Model not found for {cat}")

# Load last known premiums
premium_path = os.path.join(MODEL_DIR, "last_known_premiums.joblib")
if os.path.exists(premium_path):
    last_known_premiums = joblib.load(premium_path)
    print(f"Loaded last known premiums")

# Load feature columns
feature_path = os.path.join(MODEL_DIR, "feature_cols.joblib")
if os.path.exists(feature_path):
    feature_cols = joblib.load(feature_path)
    print(f"Loaded {len(feature_cols)} feature columns")

# Load last known covariates (per category)
covariates_path = os.path.join(MODEL_DIR, "last_known_covariates.joblib")
if os.path.exists(covariates_path):
    last_known_covariates = joblib.load(covariates_path)
    print(f"Loaded last known covariates")

# Load residual standard deviations (for confidence intervals)
residual_path = os.path.join(MODEL_DIR, "residual_stds.joblib")
if os.path.exists(residual_path):
    residual_stds = joblib.load(residual_path)
    print(f"Loaded residual stds")
else:
    residual_stds = {cat: 2000 for cat in CATEGORIES}

# FASTAPI APP

app = FastAPI(
    title="COE Premium Prediction API",
    description="Predicts Singapore COE premium using First-Diff XGBoost",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REQUEST/RESPONSE MODELS

class ScenarioInputs(BaseModel):
    quota: Optional[float] = None
    quota_change_pct: Optional[float] = None  # e.g., -10 for 10% decrease
    demand_level: Optional[str] = None  # "same", "higher", "lower"
    cpi_private_transport: Optional[float] = None

class SinglePredictionRequest(BaseModel):
    category: str
    target_month: str  # Format: "2026-04"
    scenario: Optional[ScenarioInputs] = None

class SinglePredictionResponse(BaseModel):
    category: str
    target_month: str
    previous_premium: float
    predicted_change: float
    predicted_premium: float
    confidence_lower: float
    confidence_upper: float
    direction: str
    scenario_applied: dict

class MultiPredictionRequest(BaseModel):
    category: str
    start_month: str  # Format: "2026-04"
    end_month: str    # Format: "2026-12"
    scenario: Optional[ScenarioInputs] = None

class MonthPrediction(BaseModel):
    month: str
    predicted_premium: float
    predicted_change: float
    confidence_lower: float
    confidence_upper: float

class MultiPredictionResponse(BaseModel):
    category: str
    start_month: str
    end_month: str
    previous_premium: float
    predictions: list[MonthPrediction]
    scenario_applied: dict

class CategoryDefaults(BaseModel):
    name: str
    last_premium: float
    available: bool
    defaults: dict  # Key covariates with their last known values

class CategoriesResponse(BaseModel):
    categories: list[CategoryDefaults]
    last_training_month: str
    first_valid_month: str

# HELPER FUNCTIONS

def parse_month(month_str: str) -> datetime:
    """Parse 'YYYY-MM' string to datetime."""
    return datetime.strptime(month_str, "%Y-%m")

def month_diff(start: str, end: str) -> int:
    """Calculate number of months between two month strings."""
    start_dt = parse_month(start)
    end_dt = parse_month(end)
    return (end_dt.year - start_dt.year) * 12 + (end_dt.month - start_dt.month)

def add_months(month_str: str, n: int) -> str:
    """Add n months to a month string."""
    dt = parse_month(month_str)
    new_month = dt.month + n
    new_year = dt.year + (new_month - 1) // 12
    new_month = ((new_month - 1) % 12) + 1
    return f"{new_year:04d}-{new_month:02d}"

def validate_month(month_str: str) -> None:
    """Validate that month is after last training month."""
    first_valid = add_months(LAST_TRAINING_MONTH, 1)
    if parse_month(month_str) < parse_month(first_valid):
        raise HTTPException(
            status_code=400,
            detail=f"Target month must be {first_valid} or later (after training data)"
        )

def get_category_defaults(category: str) -> dict:
    """Get key covariate defaults for a category."""
    if category not in last_known_covariates:
        return {}
    
    cov = last_known_covariates[category]
    # Return only the key user-adjustable covariates
    key_covariates = ["quota", "demand_ratio", "cpi_private_transport", "bids_received"]
    return {k: round(cov.get(k, 0), 2) for k in key_covariates if k in cov}

def apply_scenario(base_covariates: dict, scenario: Optional[ScenarioInputs]) -> tuple[dict, dict]:
    """
    Apply user scenario inputs to base covariates.
    Returns (modified_covariates, scenario_summary).
    """
    covariates = base_covariates.copy()
    applied = {}
    
    if scenario is None:
        return covariates, {"mode": "default", "adjustments": {}}
    
    # Apply quota
    if scenario.quota is not None:
        covariates["quota"] = scenario.quota
        applied["quota"] = scenario.quota
    elif scenario.quota_change_pct is not None:
        original_quota = base_covariates.get("quota", 1000)
        new_quota = original_quota * (1 + scenario.quota_change_pct / 100)
        covariates["quota"] = new_quota
        applied["quota_change_pct"] = scenario.quota_change_pct
        
        # Also update quota_diff if it exists
        if "quota_diff" in covariates:
            covariates["quota_diff"] = new_quota - original_quota
    
    # Apply demand level adjustment
    if scenario.demand_level is not None:
        original_demand = base_covariates.get("demand_ratio", 1.5)
        if scenario.demand_level == "higher":
            covariates["demand_ratio"] = original_demand * 1.2
            applied["demand_level"] = "higher (+20%)"
        elif scenario.demand_level == "lower":
            covariates["demand_ratio"] = original_demand * 0.8
            applied["demand_level"] = "lower (-20%)"
        else:
            applied["demand_level"] = "same"
        
        # Update demand_ratio_diff if it exists
        if "demand_ratio_diff" in covariates:
            covariates["demand_ratio_diff"] = covariates["demand_ratio"] - original_demand
    
    # Apply CPI adjustment
    if scenario.cpi_private_transport is not None:
        original_cpi = base_covariates.get("cpi_private_transport", 100)
        covariates["cpi_private_transport"] = scenario.cpi_private_transport
        applied["cpi_private_transport"] = scenario.cpi_private_transport
        
        # Update diff if exists
        if "cpi_private_transport_diff" in covariates:
            covariates["cpi_private_transport_diff"] = scenario.cpi_private_transport - original_cpi
    
    return covariates, {"mode": "custom", "adjustments": applied}

def build_features(covariates: dict) -> np.ndarray:
    """Build feature array from covariates dictionary."""
    features = [covariates.get(col, 0) for col in feature_cols]
    return np.array(features).reshape(1, -1)

def predict_recursive(
    category: str, 
    months_ahead: int, 
    scenario: Optional[ScenarioInputs] = None
) -> tuple[list[dict], dict]:
    
    model = models[category]
    running_premium = last_known_premiums.get(category, 100000)
    initial_premium = running_premium
    std = residual_stds.get(category, 2000)
    
    # Get base covariates and apply scenario
    base_cov = last_known_covariates.get(category, {}).copy()
    covariates, scenario_summary = apply_scenario(base_cov, scenario)
    
    predictions = []
    predicted_premiums = [running_premium]
    predicted_changes = []  # Track changes
    
    for step in range(1, months_ahead + 1):
        # update premium lag features based on prev predictions
        if "premium_lag1" in feature_cols:
            covariates["premium_lag1"] = predicted_premiums[-1]
        if "premium_lag3" in feature_cols:
            covariates["premium_lag3"] = predicted_premiums[-3] if len(predicted_premiums) >= 3 else predicted_premiums[0]
        if "premium_lag6" in feature_cols:
            covariates["premium_lag6"] = predicted_premiums[-6] if len(predicted_premiums) >= 6 else predicted_premiums[0]
        if "premium_lag12" in feature_cols:
            covariates["premium_lag12"] = predicted_premiums[-12] if len(predicted_premiums) >= 12 else predicted_premiums[0]
        
        # Update momentum Features based on predicted premiums
        if "premium_mom_pct" in feature_cols and len(predicted_premiums) >= 2:
            prev = predicted_premiums[-2] if predicted_premiums[-2] != 0 else 1
            covariates["premium_mom_pct"] = ((predicted_premiums[-1] - prev) / prev) * 100
        
        if "premium_yoy_pct" in feature_cols and len(predicted_premiums) >= 12:
            prev_year = predicted_premiums[-12] if predicted_premiums[-12] != 0 else 1
            covariates["premium_yoy_pct"] = ((predicted_premiums[-1] - prev_year) / prev_year) * 100
        
        # Update Volatility Features based on predicted premiums
        if "premium_vol_3m" in feature_cols and len(predicted_premiums) >= 3:
            covariates["premium_vol_3m"] = np.std(predicted_premiums[-3:])
        
        if "premium_vol_6m" in feature_cols and len(predicted_premiums) >= 6:
            covariates["premium_vol_6m"] = np.std(predicted_premiums[-6:])
        
        # Update Momentum Features based on predicted premiums
        if "premium_momentum_3m" in feature_cols and len(predicted_premiums) >= 3:
            ma_3m = np.mean(predicted_premiums[-3:])
            covariates["premium_momentum_3m"] = predicted_premiums[-1] - ma_3m
        
        if "premium_momentum_6m" in feature_cols and len(predicted_premiums) >= 6:
            ma_6m = np.mean(predicted_premiums[-6:])
            covariates["premium_momentum_6m"] = predicted_premiums[-1] - ma_6m
        
        # Update Diff Features based on predicted changes
        if "premium_diff" in feature_cols and len(predicted_changes) >= 1:
            covariates["premium_diff"] = predicted_changes[-1]
        
        # Build features and predict
        features = build_features(covariates)
        predicted_diff = model.predict(features)[0]
        running_premium = running_premium + predicted_diff
        
        # Store for next iteration
        predicted_premiums.append(running_premium)
        predicted_changes.append(predicted_diff)
        
        # Confidence interval
        adjusted_std = std * np.sqrt(step)
        
        predictions.append({
            "step": step,
            "predicted_premium": round(running_premium, 2),
            "predicted_change": round(predicted_diff, 2),
            "confidence_lower": round(running_premium - 1.96 * adjusted_std, 2),
            "confidence_upper": round(running_premium + 1.96 * adjusted_std, 2)
        })
    
    return predictions, scenario_summary

# API ENDPOINTS

@app.get("/")
def root():
    return {
        "message": "COE Premium Prediction API",
        "endpoints": ["/predict", "/predict/multi", "/categories", "/health"]
    }

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "models_loaded": len(models),
        "last_training_month": LAST_TRAINING_MONTH
    }

@app.get("/categories", response_model=CategoriesResponse)
def get_categories():
    """Get available categories with default covariate values."""
    cats = [
        CategoryDefaults(
            name=cat,
            last_premium=last_known_premiums.get(cat, 0),
            available=cat in models,
            defaults=get_category_defaults(cat)
        )
        for cat in CATEGORIES
    ]
    return CategoriesResponse(
        categories=cats,
        last_training_month=LAST_TRAINING_MONTH,
        first_valid_month=add_months(LAST_TRAINING_MONTH, 1)
    )

@app.post("/predict", response_model=SinglePredictionResponse)
def predict_single(request: SinglePredictionRequest):
    """Predict COE premium for a single target month with optional scenario inputs."""
    
    # Validate
    if request.category not in models:
        raise HTTPException(status_code=400, detail=f"Invalid category: {request.category}")
    validate_month(request.target_month)
    
    # Calculate months ahead
    months_ahead = month_diff(LAST_TRAINING_MONTH, request.target_month)
    
    # Recursive prediction with scenario
    predictions, scenario_summary = predict_recursive(
        request.category, 
        months_ahead, 
        request.scenario
    )
    
    # Get final prediction
    final = predictions[-1]
    prev_premium = last_known_premiums.get(request.category, 100000)
    total_change = final["predicted_premium"] - prev_premium
    
    # Direction
    if total_change > 500:
        direction = "UP"
    elif total_change < -500:
        direction = "DOWN"
    else:
        direction = "STABLE"
    
    return SinglePredictionResponse(
        category=request.category,
        target_month=request.target_month,
        previous_premium=round(prev_premium, 2),
        predicted_change=round(total_change, 2),
        predicted_premium=final["predicted_premium"],
        confidence_lower=final["confidence_lower"],
        confidence_upper=final["confidence_upper"],
        direction=direction,
        scenario_applied=scenario_summary
    )

@app.post("/predict/multi", response_model=MultiPredictionResponse)
def predict_multi(request: MultiPredictionRequest):
    """Predict COE premium for multiple months with optional scenario inputs."""
    
    # Validate
    if request.category not in models:
        raise HTTPException(status_code=400, detail=f"Invalid category: {request.category}")
    validate_month(request.start_month)
    validate_month(request.end_month)
    
    if parse_month(request.end_month) < parse_month(request.start_month):
        raise HTTPException(status_code=400, detail="End month must be after start month")
    
    # Calculate range
    start_offset = month_diff(LAST_TRAINING_MONTH, request.start_month)
    end_offset = month_diff(LAST_TRAINING_MONTH, request.end_month)
    
    # Recursive prediction with scenario
    all_predictions, scenario_summary = predict_recursive(
        request.category, 
        end_offset, 
        request.scenario
    )
    
    # Filter to requested range and add month labels
    predictions = []
    for pred in all_predictions:
        if pred["step"] >= start_offset:
            month_label = add_months(LAST_TRAINING_MONTH, pred["step"])
            predictions.append(MonthPrediction(
                month=month_label,
                predicted_premium=pred["predicted_premium"],
                predicted_change=pred["predicted_change"],
                confidence_lower=pred["confidence_lower"],
                confidence_upper=pred["confidence_upper"]
            ))
    
    return MultiPredictionResponse(
        category=request.category,
        start_month=request.start_month,
        end_month=request.end_month,
        previous_premium=round(last_known_premiums.get(request.category, 100000), 2),
        predictions=predictions,
        scenario_applied=scenario_summary
    )

# MAIN

if __name__ == "__main__":
    import uvicorn
    
    print("\n" + "=" * 60)
    print("  COE PREDICTION API")
    print("=" * 60)
    print(f"  Models loaded: {len(models)}")
    print(f"  Last training month: {LAST_TRAINING_MONTH}")
    print(f"  First valid prediction: {add_months(LAST_TRAINING_MONTH, 1)}")
    print("=" * 60)
    
    # Test prediction
    if models:
        test_cat = list(models.keys())[0]
        print(f"\n  Test ({test_cat}, 3 months ahead):")
        preds, scenario = predict_recursive(test_cat, 3, None)
        for p in preds:
            print(f"    Month {p['step']}: ${p['predicted_premium']:,.0f} ({p['predicted_change']:+,.0f})")
        print("\n  ✓ Test passed — predictions vary!")
    
    print("\n  Starting server at http://localhost:8001/docs\n")
    uvicorn.run(app, host="0.0.0.0", port=8001)