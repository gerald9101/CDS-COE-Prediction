"use client";
import React, { useState, useEffect } from "react";

function Single() {
  // Tab state
  const [activeTab, setActiveTab] = useState("single");
  
  // Form state
  const [category, setCategory] = useState("Category A");
  const [targetMonth, setTargetMonth] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  
  // Scenario state
  const [showScenario, setShowScenario] = useState(false);
  const [quotaMode, setQuotaMode] = useState("default"); // "default", "absolute", "percent"
  const [quotaValue, setQuotaValue] = useState("");
  const [quotaChangePct, setQuotaChangePct] = useState("");
  const [demandLevel, setDemandLevel] = useState("same");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cpiValue, setCpiValue] = useState("");
  
  // API state
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [categories, setCategories] = useState([]);
  const [firstValidMonth, setFirstValidMonth] = useState("2026-04");
  const [categoryDefaults, setCategoryDefaults] = useState({});
  
  // Fetch categories on mount
  useEffect(() => {
    fetch("http://localhost:8001/categories")
      .then(res => res.json())
      .then(data => {
        setCategories(data.categories);
        setFirstValidMonth(data.first_valid_month);
        setTargetMonth(data.first_valid_month);
        setStartMonth(data.first_valid_month);
        
        // Build defaults lookup
        const defaults = {};
        data.categories.forEach(cat => {
          defaults[cat.name] = cat.defaults;
        });
        setCategoryDefaults(defaults);
        
        // Set end month to 6 months later
        const [year, month] = data.first_valid_month.split("-").map(Number);
        const endDate = new Date(year, month - 1 + 6, 1);
        setEndMonth(`${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}`);
      })
      .catch(err => console.error("Failed to fetch categories:", err));
  }, []);
  
  // Get current category defaults
  const currentDefaults = categoryDefaults[category] || {};
  
  // Build scenario object for API
  const buildScenario = () => {
    if (!showScenario) return null;
    
    const scenario = {};
    
    if (quotaMode === "absolute" && quotaValue) {
      scenario.quota = Number(quotaValue);
    } else if (quotaMode === "percent" && quotaChangePct) {
      scenario.quota_change_pct = Number(quotaChangePct);
    }
    
    if (demandLevel !== "same") {
      scenario.demand_level = demandLevel;
    }
    
    if (showAdvanced && cpiValue) {
      scenario.cpi_private_transport = Number(cpiValue);
    }
    
    return Object.keys(scenario).length > 0 ? scenario : null;
  };

  // Handle single prediction
  const handleSinglePredict = async () => {
    if (!targetMonth) {
      alert("Please select a target month");
      return;
    }
    
    setLoading(true);
    setResult(null);
    
    try {
      const body = {
        category,
        target_month: targetMonth
      };
      
      const scenario = buildScenario();
      if (scenario) {
        body.scenario = scenario;
      }
      
      const res = await fetch("http://localhost:8001/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Prediction failed");
        return;
      }
      
      const data = await res.json();
      setResult({ type: "single", data });
    } catch (err) {
      console.error(err);
      alert("Failed to connect to API");
    } finally {
      setLoading(false);
    }
  };

  // Handle multi prediction
  const handleMultiPredict = async () => {
    if (!startMonth || !endMonth) {
      alert("Please select start and end months");
      return;
    }
    
    setLoading(true);
    setResult(null);
    
    try {
      const body = {
        category,
        start_month: startMonth,
        end_month: endMonth
      };
      
      const scenario = buildScenario();
      if (scenario) {
        body.scenario = scenario;
      }
      
      const res = await fetch("http://localhost:8001/predict/multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Prediction failed");
        return;
      }
      
      const data = await res.json();
      setResult({ type: "multi", data });
    } catch (err) {
      console.error(err);
      alert("Failed to connect to API");
    } finally {
      setLoading(false);
    }
  };

  // Format currency
  const formatCurrency = (val) => `$${val.toLocaleString()}`;

  // Render scenario summary
  const renderScenarioSummary = (scenarioApplied) => {
    if (!scenarioApplied || scenarioApplied.mode === "default") {
      return <p style={{ color: "#666", fontSize: 12 }}>Using default market conditions</p>;
    }
    
    const { adjustments } = scenarioApplied;
    return (
      <div style={{ background: "#fff3cd", padding: 10, borderRadius: 6, marginBottom: 15, fontSize: 12 }}>
        <strong>Scenario Applied:</strong>
        <ul style={{ margin: "5px 0 0 15px", padding: 0 }}>
          {adjustments.quota && <li>Quota: {adjustments.quota.toLocaleString()}</li>}
          {adjustments.quota_change_pct && <li>Quota change: {adjustments.quota_change_pct > 0 ? "+" : ""}{adjustments.quota_change_pct}%</li>}
          {adjustments.demand_level && <li>Demand: {adjustments.demand_level}</li>}
          {adjustments.cpi_private_transport && <li>CPI Transport: {adjustments.cpi_private_transport}</li>}
        </ul>
      </div>
    );
  };

  // Render single result
  const renderSingleResult = () => {
    if (!result || result.type !== "single") return null;
    const { data } = result;
    
    const isUp = data.direction === "UP";
    const isDown = data.direction === "DOWN";
    
    return (
      <div style={{ marginTop: 20 }}>
        <h4>Prediction Result</h4>
        
        {renderScenarioSummary(data.scenario_applied)}
        
        <div style={{
          padding: 20,
          background: isUp ? "#e8f5e9" : isDown ? "#ffebee" : "#f5f5f5",
          borderRadius: 10,
          marginBottom: 15
        }}>
          <h2 style={{ 
            color: isUp ? "green" : isDown ? "red" : "gray",
            margin: 0
          }}>
            {formatCurrency(data.predicted_premium)}
          </h2>
          <p style={{ margin: "5px 0", fontSize: 18 }}>
            {isUp ? "↑" : isDown ? "↓" : "→"} {data.direction}
            <span style={{ marginLeft: 10, color: "#666" }}>
              ({data.predicted_change >= 0 ? "+" : ""}{formatCurrency(data.predicted_change)})
            </span>
          </p>
        </div>
        
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>Category</td>
              <td style={{ padding: 8, borderBottom: "1px solid #eee", textAlign: "right" }}>{data.category}</td>
            </tr>
            <tr>
              <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>Target Month</td>
              <td style={{ padding: 8, borderBottom: "1px solid #eee", textAlign: "right" }}>{data.target_month}</td>
            </tr>
            <tr>
              <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>Previous Premium</td>
              <td style={{ padding: 8, borderBottom: "1px solid #eee", textAlign: "right" }}>{formatCurrency(data.previous_premium)}</td>
            </tr>
            <tr>
              <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>95% Confidence Interval</td>
              <td style={{ padding: 8, borderBottom: "1px solid #eee", textAlign: "right" }}>
                {formatCurrency(data.confidence_lower)} – {formatCurrency(data.confidence_upper)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // Render multi result
  const renderMultiResult = () => {
    if (!result || result.type !== "multi") return null;
    const { data } = result;
    
    // Find min/max for chart scaling
    const allValues = data.predictions.flatMap(p => [p.confidence_lower, p.confidence_upper]);
    const minVal = Math.min(...allValues) * 0.95;
    const maxVal = Math.max(...allValues) * 1.05;
    const range = maxVal - minVal;
    
    return (
      <div style={{ marginTop: 20 }}>
        <h4>Prediction Results: {data.category}</h4>
        <p style={{ color: "#666" }}>
          From {data.start_month} to {data.end_month} | Base: {formatCurrency(data.previous_premium)}
        </p>
        
        {renderScenarioSummary(data.scenario_applied)}
        
        {/* Simple Chart */}
        <div style={{
          position: "relative",
          height: 250,
          border: "1px solid #eee",
          borderRadius: 10,
          padding: 20,
          marginBottom: 20,
          background: "#fafafa"
        }}>
          <svg width="100%" height="100%" viewBox="0 0 500 200">
            {/* Confidence interval area */}
            <path
              d={
                `M ${data.predictions.map((p, i) => 
                  `${(i / Math.max(data.predictions.length - 1, 1)) * 480 + 10},${200 - ((p.confidence_upper - minVal) / range) * 180}`
                ).join(" L ")} ` +
                `L ${data.predictions.slice().reverse().map((p, i) => 
                  `${((data.predictions.length - 1 - i) / Math.max(data.predictions.length - 1, 1)) * 480 + 10},${200 - ((p.confidence_lower - minVal) / range) * 180}`
                ).join(" L ")} Z`
              }
              fill="rgba(33, 150, 243, 0.2)"
            />
            
            {/* Prediction line */}
            <polyline
              points={data.predictions.map((p, i) => 
                `${(i / Math.max(data.predictions.length - 1, 1)) * 480 + 10},${200 - ((p.predicted_premium - minVal) / range) * 180}`
              ).join(" ")}
              fill="none"
              stroke="#2196F3"
              strokeWidth="3"
            />
            
            {/* Data points */}
            {data.predictions.map((p, i) => (
              <circle
                key={i}
                cx={(i / Math.max(data.predictions.length - 1, 1)) * 480 + 10}
                cy={200 - ((p.predicted_premium - minVal) / range) * 180}
                r="5"
                fill="#2196F3"
              />
            ))}
          </svg>
          
          {/* Y-axis labels */}
          <div style={{ position: "absolute", left: 5, top: 15, fontSize: 10, color: "#666" }}>
            {formatCurrency(Math.round(maxVal))}
          </div>
          <div style={{ position: "absolute", left: 5, bottom: 15, fontSize: 10, color: "#666" }}>
            {formatCurrency(Math.round(minVal))}
          </div>
        </div>
        
        {/* Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={{ padding: 10, textAlign: "left" }}>Month</th>
              <th style={{ padding: 10, textAlign: "right" }}>Predicted</th>
              <th style={{ padding: 10, textAlign: "right" }}>Change</th>
              <th style={{ padding: 10, textAlign: "right" }}>95% CI</th>
            </tr>
          </thead>
          <tbody>
            {data.predictions.map((p, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>{p.month}</td>
                <td style={{ padding: 10, textAlign: "right" }}>{formatCurrency(p.predicted_premium)}</td>
                <td style={{ 
                  padding: 10, 
                  textAlign: "right",
                  color: p.predicted_change >= 0 ? "green" : "red"
                }}>
                  {p.predicted_change >= 0 ? "+" : ""}{formatCurrency(p.predicted_change)}
                </td>
                <td style={{ padding: 10, textAlign: "right", color: "#666" }}>
                  {formatCurrency(p.confidence_lower)} – {formatCurrency(p.confidence_upper)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Render scenario inputs
  const renderScenarioInputs = () => (
    <div style={{
      background: "#f8f9fa",
      border: "1px solid #e9ecef",
      borderRadius: 8,
      padding: 15,
      marginBottom: 20
    }}>
      <div 
        onClick={() => setShowScenario(!showScenario)}
        style={{ 
          cursor: "pointer", 
          display: "flex", 
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <strong>📊 Scenario Assumptions</strong>
        <span>{showScenario ? "▲" : "▼"}</span>
      </div>
      
      {showScenario && (
        <div style={{ marginTop: 15 }}>
          {/* Quota Input */}
          <div style={{ marginBottom: 15 }}>
            <label style={{ display: "block", marginBottom: 5, fontWeight: 500 }}>
              Quota
              <span style={{ fontWeight: "normal", color: "#666", marginLeft: 8 }}>
                (Last: {currentDefaults.quota?.toLocaleString() || "N/A"})
              </span>
            </label>
            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input 
                  type="radio" 
                  checked={quotaMode === "default"} 
                  onChange={() => setQuotaMode("default")}
                />
                Same
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input 
                  type="radio" 
                  checked={quotaMode === "absolute"} 
                  onChange={() => setQuotaMode("absolute")}
                />
                Set Value
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input 
                  type="radio" 
                  checked={quotaMode === "percent"} 
                  onChange={() => setQuotaMode("percent")}
                />
                % Change
              </label>
            </div>
            
            {quotaMode === "absolute" && (
              <input
                type="number"
                value={quotaValue}
                onChange={(e) => setQuotaValue(e.target.value)}
                placeholder={`e.g., ${currentDefaults.quota || 1000}`}
                style={{
                  width: "100%",
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #ccc"
                }}
              />
            )}
            
            {quotaMode === "percent" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  value={quotaChangePct}
                  onChange={(e) => setQuotaChangePct(e.target.value)}
                  placeholder="e.g., -10 for 10% decrease"
                  style={{
                    flex: 1,
                    padding: 8,
                    borderRadius: 4,
                    border: "1px solid #ccc"
                  }}
                />
                <span>%</span>
              </div>
            )}
          </div>
          
          {/* Demand Level */}
          <div style={{ marginBottom: 15 }}>
            <label style={{ display: "block", marginBottom: 5, fontWeight: 500 }}>
              Demand Level
              <span style={{ fontWeight: "normal", color: "#666", marginLeft: 8 }}>
                (Last ratio: {currentDefaults.demand_ratio?.toFixed(2) || "N/A"})
              </span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              {["lower", "same", "higher"].map(level => (
                <label 
                  key={level}
                  style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: 4,
                    padding: "8px 12px",
                    background: demandLevel === level ? "#007bff" : "#e9ecef",
                    color: demandLevel === level ? "#fff" : "#333",
                    borderRadius: 4,
                    cursor: "pointer"
                  }}
                >
                  <input 
                    type="radio" 
                    checked={demandLevel === level} 
                    onChange={() => setDemandLevel(level)}
                    style={{ display: "none" }}
                  />
                  {level === "lower" ? "📉 Lower" : level === "same" ? "➡️ Same" : "📈 Higher"}
                </label>
              ))}
            </div>
          </div>
          
          {/* Advanced Options */}
          <div 
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ 
              cursor: "pointer", 
              color: "#007bff",
              fontSize: 14,
              marginTop: 10
            }}
          >
            {showAdvanced ? "▼" : "▶"} Advanced Options
          </div>
          
          {showAdvanced && (
            <div style={{ marginTop: 10 }}>
              <label style={{ display: "block", marginBottom: 5, fontWeight: 500 }}>
                CPI Private Transport
                <span style={{ fontWeight: "normal", color: "#666", marginLeft: 8 }}>
                  (Last: {currentDefaults.cpi_private_transport?.toFixed(1) || "N/A"})
                </span>
              </label>
              <input
                type="number"
                step="0.1"
                value={cpiValue}
                onChange={(e) => setCpiValue(e.target.value)}
                placeholder={`e.g., ${currentDefaults.cpi_private_transport?.toFixed(1) || 105}`}
                style={{
                  width: "100%",
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #ccc"
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="tc-product-single-style1">
      <div className="main-info mb-100">
        <div className="container">
          <div className="row gx-0">
            
            {/* LEFT SIDE - Inputs */}
            <div className="col-lg-6 offset-lg-1">
              <div className="product-info">
                
                <h3 className="fsz-26 fw-bold text-capitalize mb-30">
                  COE Premium Predictor
                </h3>
                
                {/* Tabs */}
                <div style={{ display: "flex", marginBottom: 20 }}>
                  <button
                    onClick={() => { setActiveTab("single"); setResult(null); }}
                    style={{
                      flex: 1,
                      padding: "12px 20px",
                      background: activeTab === "single" ? "#007bff" : "#f5f5f5",
                      color: activeTab === "single" ? "#fff" : "#333",
                      border: "none",
                      borderRadius: "6px 0 0 6px",
                      cursor: "pointer",
                      fontWeight: activeTab === "single" ? "bold" : "normal"
                    }}
                  >
                    Single Month
                  </button>
                  <button
                    onClick={() => { setActiveTab("multi"); setResult(null); }}
                    style={{
                      flex: 1,
                      padding: "12px 20px",
                      background: activeTab === "multi" ? "#007bff" : "#f5f5f5",
                      color: activeTab === "multi" ? "#fff" : "#333",
                      border: "none",
                      borderRadius: "0 6px 6px 0",
                      cursor: "pointer",
                      fontWeight: activeTab === "multi" ? "bold" : "normal"
                    }}
                  >
                    Multi-Month
                  </button>
                </div>
                
                {/* Category Dropdown */}
                <label>Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: 10,
                    marginBottom: 15,
                    borderRadius: 6,
                    border: "1px solid #ccc"
                  }}
                >
                  {categories.map((cat) => (
                    <option key={cat.name} value={cat.name} disabled={!cat.available}>
                      {cat.name} {cat.available ? `(Last: $${cat.last_premium.toLocaleString()})` : "(unavailable)"}
                    </option>
                  ))}
                </select>
                
                {/* Single Month Input */}
                {activeTab === "single" && (
                  <>
                    <label>Target Month</label>
                    <input
                      type="month"
                      value={targetMonth}
                      min={firstValidMonth}
                      onChange={(e) => setTargetMonth(e.target.value)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: 10,
                        marginBottom: 15,
                        borderRadius: 6,
                        border: "1px solid #ccc"
                      }}
                    />
                    
                    {renderScenarioInputs()}
                    
                    <button
                      onClick={handleSinglePredict}
                      disabled={loading}
                      style={{
                        padding: "12px 24px",
                        background: "#007bff",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: loading ? "not-allowed" : "pointer",
                        opacity: loading ? 0.7 : 1
                      }}
                    >
                      {loading ? "Predicting..." : "Predict Premium"}
                    </button>
                  </>
                )}
                
                {/* Multi Month Inputs */}
                {activeTab === "multi" && (
                  <>
                    <div style={{ display: "flex", gap: 15 }}>
                      <div style={{ flex: 1 }}>
                        <label>Start Month</label>
                        <input
                          type="month"
                          value={startMonth}
                          min={firstValidMonth}
                          onChange={(e) => setStartMonth(e.target.value)}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: 10,
                            marginBottom: 15,
                            borderRadius: 6,
                            border: "1px solid #ccc"
                          }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label>End Month</label>
                        <input
                          type="month"
                          value={endMonth}
                          min={startMonth || firstValidMonth}
                          onChange={(e) => setEndMonth(e.target.value)}
                          style={{
                            display: "block",
                            width: "100%",
                            padding: 10,
                            marginBottom: 15,
                            borderRadius: 6,
                            border: "1px solid #ccc"
                          }}
                        />
                      </div>
                    </div>
                    
                    {renderScenarioInputs()}
                    
                    <button
                      onClick={handleMultiPredict}
                      disabled={loading}
                      style={{
                        padding: "12px 24px",
                        background: "#007bff",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        cursor: loading ? "not-allowed" : "pointer",
                        opacity: loading ? 0.7 : 1
                      }}
                    >
                      {loading ? "Predicting..." : "Predict Range"}
                    </button>
                  </>
                )}
                
              </div>
            </div>
            
            {/* RIGHT SIDE - Results */}
            <div className="col-lg-4">
              <div style={{
                padding: 20,
                border: "1px solid #eee",
                borderRadius: 10,
                marginTop: 60,
                minHeight: 300
              }}>
                {loading ? (
                  <p>Analyzing...</p>
                ) : !result ? (
                  <p style={{ color: "#999" }}>Select options and click predict to see results</p>
                ) : result.type === "single" ? (
                  renderSingleResult()
                ) : (
                  renderMultiResult()
                )}
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </section>
  );
}

export default Single;