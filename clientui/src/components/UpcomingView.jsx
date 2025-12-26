import { useEffect, useState } from "react";
import { formatDate } from "../utils/formatDate";

export default function UpcomingView({ apiCall, setError, upcoming, setUpcoming, loading, setLoading, upcomingDate, setUpcomingDate, upcomingInterval, setUpcomingInterval, onNavigateToSchedule, currentUser, overdue, setOverdue }) {
  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedEquipmentTypeId, setSelectedEquipmentTypeId] = useState("");
  const [sortBy, setSortBy] = useState("due_date"); // "name" or "due_date"
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" or "desc"
  
  // Data for dropdowns
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);

  async function fetchUpcoming() {
    setLoading(true);
    setError("");
    try {
      // Fetch overdue items first (always show these)
      const overdueData = await apiCall("/equipment-records/overdue").catch(() => []);
      setOverdue(Array.isArray(overdueData) ? overdueData : []);

      // Fetch upcoming items with date filter
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

  // Filter and sort function
  function filterAndSortItems(items) {
    return items
      .filter(item => {
        // Search by name
        if (searchTerm) {
          const searchLower = searchTerm.toLowerCase();
          if (!item.equipment_name?.toLowerCase().startsWith(searchLower)) {
            return false;
          }
        }
        
        // Filter by client
        if (selectedClientId) {
          if (item.client_id !== parseInt(selectedClientId)) {
            return false;
          }
        }
        
        // Filter by site
        if (selectedSiteId) {
          if (item.site_id !== parseInt(selectedSiteId)) {
            return false;
          }
        }
        
        // Filter by equipment type
        if (selectedEquipmentTypeId) {
          if (item.equipment_type_id !== parseInt(selectedEquipmentTypeId)) {
            return false;
          }
        }
        
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") {
          const nameA = (a.equipment_name || "").toLowerCase();
          const nameB = (b.equipment_name || "").toLowerCase();
          if (sortOrder === "asc") {
            return nameA.localeCompare(nameB);
          } else {
            return nameB.localeCompare(nameA);
          }
        } else if (sortBy === "due_date") {
          // Handle items without due dates - put them at the end
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1; // a goes to end
          if (!b.due_date) return -1; // b goes to end
          
          const dateA = new Date(a.due_date).getTime();
          const dateB = new Date(b.due_date).getTime();
          if (sortOrder === "asc") {
            // Ascending = earliest date first (oldest to newest)
            return dateA - dateB;
          } else {
            // Descending = latest date first (newest to oldest)
            return dateB - dateA;
          }
        }
        return 0;
      });
  }

  function renderEquipmentList(items, className = "", isOverdue = false) {
    const filteredItems = filterAndSortItems(items);
    return (
      <ul className="list">
        {filteredItems.map(item => {
          const isInactive = !item.active;
          const itemStyle = isInactive && currentUser?.is_admin ? {
            opacity: 0.6,
            backgroundColor: "#f5f5f5",
            borderLeft: "3px solid #8193A4"
          } : {};
          // Add overdue styling
          const overdueStyle = isOverdue ? {
            backgroundColor: "#ffebee",
            borderLeft: "4px solid #d32f2f"
          } : {};
          return (
            <li 
              key={item.id} 
              className={`list-item ${className}`}
              style={{ cursor: "pointer", ...itemStyle, ...overdueStyle }}
              onClick={() => {
                if (onNavigateToSchedule && item.id) {
                  onNavigateToSchedule(item.id, null);
                }
              }}
            >
              <div className="list-main">
                <div className="list-title">
                  {item.equipment_name || 'Unknown'}
                  {isOverdue && (
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#d32f2f", fontWeight: "bold" }}>
                      (OVERDUE)
                    </span>
                  )}
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

  // Fetch clients and equipment types for filters
  async function fetchClients() {
    try {
      const data = await apiCall("/clients");
      setClients(data || []);
    } catch (err) {
      setClients([]);
    }
  }

  async function fetchEquipmentTypes() {
    try {
      const data = await apiCall("/equipment-types?active_only=true");
      setEquipmentTypes(data || []);
    } catch (err) {
      setEquipmentTypes([]);
    }
  }

  // Fetch sites when client is selected
  useEffect(() => {
    if (selectedClientId) {
      fetchSitesForClient(selectedClientId);
    } else {
      setSites([]);
      setSelectedSiteId("");
    }
  }, [selectedClientId]);

  async function fetchSitesForClient(clientId) {
    try {
      const data = await apiCall(`/sites?client_id=${clientId}`);
      setSites(data || []);
    } catch (err) {
      setSites([]);
    }
  }

  useEffect(() => {
    fetchUpcoming();
    fetchClients();
    fetchEquipmentTypes();
  }, [upcomingDate, upcomingInterval]);

  // Count active filters
  const activeFilterCount = [
    searchTerm,
    selectedClientId,
    selectedSiteId,
    selectedEquipmentTypeId
  ].filter(Boolean).length;

  // Get filtered counts
  const filteredOverdue = filterAndSortItems(overdue);
  const filteredUpcoming = filterAndSortItems(upcoming);
  const totalFilteredCount = filteredOverdue.length + filteredUpcoming.length;

  if (loading) return <div className="card"><p>Loading...</p></div>;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>Upcoming ({totalFilteredCount})</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button 
              className="secondary" 
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? "Hide Filters" : `Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button className="secondary" onClick={fetchUpcoming}>Refresh</button>
          </div>
        </div>

        {showFilters && (
          <div style={{ padding: "1rem", borderBottom: "1px solid #8193A4" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", color: "#2D3234" }}>Filters</h3>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSearchTerm("");
                  setSelectedClientId("");
                  setSelectedSiteId("");
                  setSelectedEquipmentTypeId("");
                  setSortBy("due_date");
                  setSortOrder("asc");
                }}
                style={{ 
                  padding: "0.5rem 1rem",
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap"
                }}
              >
                Reset Filters
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Search by Name
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search equipment name..."
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    fontSize: "0.9rem"
                  }}
                />
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Client
                </label>
                <select
                  value={selectedClientId}
                  onChange={(e) => {
                    setSelectedClientId(e.target.value);
                    setSelectedSiteId("");
                  }}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    fontSize: "0.9rem"
                  }}
                >
                  <option value="">All Clients</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id.toString()}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Site
                </label>
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  disabled={!selectedClientId}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    fontSize: "0.9rem",
                    backgroundColor: !selectedClientId ? "#f0f0f0" : "#fff"
                  }}
                >
                  <option value="">All Sites</option>
                  {sites.map(site => (
                    <option key={site.id} value={site.id.toString()}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Equipment Type
                </label>
                <select
                  value={selectedEquipmentTypeId}
                  onChange={(e) => setSelectedEquipmentTypeId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    fontSize: "0.9rem"
                  }}
                >
                  <option value="">All Types</option>
                  {equipmentTypes.map(type => (
                    <option key={type.id} value={type.id.toString()}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Sort By
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    fontSize: "0.9rem"
                  }}
                >
                  <option value="name">Name</option>
                  <option value="due_date">Due Date</option>
                </select>
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Sort Order
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className={sortOrder === "asc" ? "primary" : "secondary"}
                    onClick={() => setSortOrder("asc")}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.85rem",
                      whiteSpace: "nowrap",
                      flex: 1
                    }}
                  >
                    {sortBy === "name" ? "A-Z" : "Ascending"}
                  </button>
                  <button
                    type="button"
                    className={sortOrder === "desc" ? "primary" : "secondary"}
                    onClick={() => setSortOrder("desc")}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.85rem",
                      whiteSpace: "nowrap",
                      flex: 1
                    }}
                  >
                    {sortBy === "name" ? "Z-A" : "Descending"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
        {filteredOverdue.length === 0 && filteredUpcoming.length === 0 ? (
          <p className="empty">
            {overdue.length === 0 && upcoming.length === 0 
              ? "No upcoming equipment records" 
              : "No equipment records match your filters"}
          </p>
        ) : (
          <div>
            {filteredOverdue.length > 0 && (
              <div>
                <h3 style={{ padding: "1rem 1rem 0.5rem 1rem", margin: 0, fontSize: "1rem", color: "#d32f2f", fontWeight: "bold" }}>
                  Overdue ({filteredOverdue.length})
                </h3>
                {renderEquipmentList(overdue, "overdue", true)}
              </div>
            )}
            {filteredUpcoming.length > 0 && (
              <div>
                {filteredOverdue.length > 0 && (
                  <h3 style={{ padding: "1rem 1rem 0.5rem 1rem", margin: 0, fontSize: "1rem", color: "#2D3234" }}>
                    Upcoming ({filteredUpcoming.length})
                  </h3>
                )}
                {renderEquipmentList(upcoming, "planned", false)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

