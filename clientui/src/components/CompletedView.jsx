import { useEffect, useState } from "react";
import { formatDate } from "../utils/formatDate";

export default function CompletedView({ apiCall, setError, loading, setLoading, currentUser, completions, setCompletions, onRefresh }) {
  
  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedEquipmentTypeId, setSelectedEquipmentTypeId] = useState("");
  const [sortBy, setSortBy] = useState("completed_at"); // "completed_at" or "due_date" or "name"
  const [sortOrder, setSortOrder] = useState("desc"); // "asc" or "desc"
  
  // Data for dropdowns
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);

  async function fetchCompletions() {
    setLoading(true);
    setError("");
    try {
      const data = await apiCall("/equipment-completions");
      const completionsData = Array.isArray(data) ? data : [];
      if (setCompletions) {
        setCompletions(completionsData);
      }
    } catch (err) {
      const errorMessage = err.message || "Failed to load completion records";
      setError(errorMessage);
      console.error("Error fetching completions:", err);
      if (setCompletions) {
        setCompletions([]);
      }
    } finally {
      setLoading(false);
    }
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
    if (!completions || completions.length === 0) {
      fetchCompletions();
    }
    fetchClients();
    fetchEquipmentTypes();
  }, []);

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
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          
          const dateA = new Date(a.due_date).getTime();
          const dateB = new Date(b.due_date).getTime();
          if (sortOrder === "asc") {
            return dateA - dateB;
          } else {
            return dateB - dateA;
          }
        } else if (sortBy === "completed_at") {
          const dateA = new Date(a.completed_at).getTime();
          const dateB = new Date(b.completed_at).getTime();
          if (sortOrder === "asc") {
            return dateA - dateB;
          } else {
            return dateB - dateA;
          }
        }
        return 0;
      });
  }

  // Count active filters
  const activeFilterCount = [
    searchTerm,
    selectedClientId,
    selectedSiteId,
    selectedEquipmentTypeId
  ].filter(Boolean).length;

  const filteredCompletions = filterAndSortItems(completions);

  if (loading) return <div className="card"><p>Loading...</p></div>;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>Completed ({filteredCompletions.length})</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button 
              className="secondary" 
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? "Hide Filters" : `Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button className="secondary" onClick={() => {
              fetchCompletions();
              if (onRefresh) onRefresh();
            }}>Refresh</button>
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
                  setSortBy("completed_at");
                  setSortOrder("desc");
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
                  <option value="completed_at">Completed Date</option>
                  <option value="due_date">Due Date</option>
                  <option value="name">Name</option>
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

        {completions.length === 0 ? (
          <p className="empty">No completion records yet</p>
        ) : filteredCompletions.length === 0 ? (
          <p className="empty">No completion records match your filters</p>
        ) : (
          <ul className="list">
            {filteredCompletions.map(completion => (
              <li key={completion.id} className="list-item">
                <div className="list-main">
                  <div className="list-title">
                    {completion.equipment_name || 'Unknown'}
                  </div>
                  <div className="list-subtitle">
                    {completion.equipment_type_name && `Type: ${completion.equipment_type_name} • `}
                    Client: {completion.client_name}
                    {completion.site_name && ` • Site: ${completion.site_name}`}
                    {` • Completed: ${formatDate(completion.completed_at)}`}
                    {` • Due Date: ${formatDate(completion.due_date)}`}
                    {completion.completed_by_user && ` • By: ${completion.completed_by_user}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

