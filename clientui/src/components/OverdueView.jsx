import { useEffect } from "react";
import { formatDate } from "../utils/formatDate";

export default function OverdueView({ apiCall, setError, overdue, setOverdue, loading, setLoading, onNavigateToSchedule, currentUser }) {
  async function fetchOverdue() {
    setLoading(true);
    setError("");
    try {
      const data = await apiCall("/equipment-records/overdue").catch(() => []);
      setOverdue(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMessage = err.message || "Failed to load data";
      setError(errorMessage);
      console.error("Error fetching data:", err);
      setOverdue([]);
    } finally {
      setLoading(false);
    }
  }

  function renderEquipmentList(items, className = "") {
    return (
      <ul className="list">
        {items.map(item => {
          const isInactive = !item.active;
          const itemStyle = isInactive && currentUser?.is_admin ? {
            opacity: 0.6,
            backgroundColor: "#f5f5f5",
            borderLeft: "3px solid #8193A4"
          } : {};
          return (
            <li 
              key={item.id} 
              className={`list-item ${className}`}
              style={{ cursor: "pointer", ...itemStyle }}
              onClick={() => {
                if (onNavigateToSchedule && item.id) {
                  onNavigateToSchedule(item.id, null);
                }
              }}
            >
              <div className="list-main">
                <div className="list-title">
                  {item.equipment_name || 'Unknown'}
                  {isInactive && currentUser?.is_admin && (
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#8193A4", fontStyle: "italic" }}>
                      (Inactive)
                    </span>
                  )}
                </div>
                <div className="list-subtitle">
                  {item.equipment_type_name && `Type: ${item.equipment_type_name} • `}
                  Client: {item.client_name}
                  {item.site_name && ` • Site: ${item.site_name}`}
                  {` • Due: ${formatDate(item.due_date)}`}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  useEffect(() => {
    fetchOverdue();
  }, []);

  if (loading) return <div className="card"><p>Loading...</p></div>;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>Overdue</h2>
          <div>
            <button className="secondary" onClick={fetchOverdue}>Refresh</button>
          </div>
        </div>
        {overdue.length === 0 ? (
          <p className="empty">No overdue equipment records</p>
        ) : (
          renderEquipmentList(overdue, "due")
        )}
      </div>
    </div>
  );
}

