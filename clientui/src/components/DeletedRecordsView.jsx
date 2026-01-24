import { useState, useEffect } from "react";
import { formatDate } from "../utils/formatDate";

export default function DeletedRecordsView({ apiCall, currentUser, businesses, onRefresh }) {
  const [deletedRecords, setDeletedRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterBusinessId, setFilterBusinessId] = useState("");
  const [sortBy, setSortBy] = useState("deleted_at");
  const [sortOrder, setSortOrder] = useState("desc");

  useEffect(() => {
    fetchDeletedRecords();
  }, [filterType, filterBusinessId]);

  async function fetchDeletedRecords() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterType) {
        params.append("record_type", filterType);
      }
      if (filterBusinessId) {
        params.append("business_id", filterBusinessId);
      }
      const endpoint = `/deleted-records${params.toString() ? `?${params.toString()}` : ""}`;
      const data = await apiCall(endpoint);
      setDeletedRecords(data || []);
    } catch (err) {
      setError(err.message || "Failed to fetch deleted records");
      setDeletedRecords([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(record) {
    if (!window.confirm(`Are you sure you want to restore "${record.name}"?`)) {
      return;
    }

    try {
      const endpoint = `/${record.type}s/${record.id}/restore`;
      await apiCall(endpoint, { method: "POST" });
      setError("");
      // Refresh the list
      fetchDeletedRecords();
      // Call parent refresh callback if provided
      if (onRefresh) {
        onRefresh();
      }
    } catch (err) {
      setError(err.message || "Failed to restore record");
    }
  }

  const sortedRecords = [...deletedRecords].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];
    
    // Handle date sorting
    if (sortBy === "deleted_at") {
      aVal = new Date(aVal);
      bVal = new Date(bVal);
    }
    
    if (sortOrder === "asc") {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });

  const getTypeLabel = (type) => {
    const labels = {
      client: "Client",
      site: "Site",
      equipment_record: "Equipment",
      equipment_type: "Equipment Type"
    };
    return labels[type] || type;
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Deleted Records</h2>
        <button onClick={fetchDeletedRecords} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="error-banner" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div className="filter-section" style={{ marginBottom: "1rem", padding: "1rem", background: "#f5f5f5", borderRadius: "0.5rem" }}>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Filter by Type:
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ marginLeft: "0.5rem", padding: "0.5rem" }}
            >
              <option value="">All Types</option>
              <option value="client">Clients</option>
              <option value="site">Sites</option>
              <option value="equipment_record">Equipment</option>
              <option value="equipment_type">Equipment Types</option>
            </select>
          </label>
          <label>
            Filter by Business:
            <select
              value={filterBusinessId}
              onChange={(e) => setFilterBusinessId(e.target.value)}
              style={{ marginLeft: "0.5rem", padding: "0.5rem" }}
            >
              <option value="">All Businesses</option>
              {businesses.map(business => (
                <option key={business.id} value={business.id.toString()}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort by:
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ marginLeft: "0.5rem", padding: "0.5rem" }}
            >
              <option value="deleted_at">Deleted Date</option>
              <option value="name">Name</option>
              <option value="type">Type</option>
              <option value="deleted_by">Deleted By</option>
            </select>
          </label>
          <label>
            Order:
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              style={{ marginLeft: "0.5rem", padding: "0.5rem" }}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem" }}>Loading deleted records...</div>
      ) : sortedRecords.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "#8193A4" }}>
          No deleted records found.
        </div>
      ) : (
        <ul className="list">
          {sortedRecords.map(record => (
            <li key={`${record.type}-${record.id}`} className="list-item">
              <div className="list-main">
                <div className="list-title">
                  {record.name}
                  <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", color: "#8193A4", fontWeight: "normal" }}>
                    ({getTypeLabel(record.type)})
                  </span>
                </div>
                <div className="list-subtitle">
                  <strong>Deleted:</strong> {formatDate(record.deleted_at)} by <strong>{record.deleted_by}</strong>
                  {record.additional_info && (
                    <>
                      {record.additional_info.client_name && (
                        <span style={{ marginLeft: "1rem" }}>
                          • Client: {record.additional_info.client_name}
                        </span>
                      )}
                      {record.additional_info.site_name && (
                        <span style={{ marginLeft: "1rem" }}>
                          • Site: {record.additional_info.site_name}
                        </span>
                      )}
                    </>
                  )}
                  {record.business_id && (
                    <span style={{ marginLeft: "1rem" }}>
                      • Business: {businesses.find(b => b.id === record.business_id)?.name || record.business_id}
                    </span>
                  )}
                </div>
              </div>
              <div className="list-actions">
                <button onClick={() => handleRestore(record)}>Restore</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

