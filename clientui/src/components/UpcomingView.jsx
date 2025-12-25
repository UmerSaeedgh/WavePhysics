import { useEffect } from "react";
import { formatDate } from "../utils/formatDate";

export default function UpcomingView({ apiCall, setError, upcoming, setUpcoming, loading, setLoading, upcomingDate, setUpcomingDate, upcomingInterval, setUpcomingInterval, onNavigateToSchedule, currentUser }) {
  async function fetchUpcoming() {
    setLoading(true);
    setError("");
    try {
      let url = "/equipment-records/upcoming";
      
      const startDate = upcomingDate || new Date().toISOString().split('T')[0];
      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + (upcomingInterval * 7));
      const endDate = end.toISOString().split('T')[0];
      
      url += `?start_date=${startDate}&end_date=${endDate}`;
      
      const data = await apiCall(url).catch(() => []);
      setUpcoming(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMessage = err.message || "Failed to load upcoming data";
      setError(errorMessage);
      console.error("Error fetching upcoming data:", err);
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
    fetchUpcoming();
  }, [upcomingDate, upcomingInterval]);

  if (loading) return <div className="card"><p>Loading...</p></div>;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>Upcoming</h2>
          <div>
            <button className="secondary" onClick={fetchUpcoming}>Refresh</button>
          </div>
        </div>
        <div style={{ padding: "1rem", borderBottom: "1px solid #ddd" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Date
              <input
                type="date"
                value={upcomingDate}
                onChange={(e) => {
                  setUpcomingDate(e.target.value);
                }}
                style={{ padding: "0.5rem" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Interval (weeks)
              <input
                type="number"
                min="1"
                value={upcomingInterval}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 1;
                  setUpcomingInterval(value);
                }}
                style={{ padding: "0.5rem", width: "120px" }}
              />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginTop: "1.5rem" }}>
              <div style={{ fontSize: "0.875rem", color: "#666" }}>
                Range: {upcomingDate} to {
                  (() => {
                    const start = new Date(upcomingDate);
                    const end = new Date(start);
                    end.setDate(end.getDate() + (upcomingInterval * 7));
                    return end.toISOString().split('T')[0];
                  })()
                }
              </div>
            </div>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <p className="empty">No upcoming equipment records</p>
        ) : (
          renderEquipmentList(upcoming, "planned")
        )}
      </div>
    </div>
  );
}

