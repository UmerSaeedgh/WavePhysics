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
  
  // History modal state
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedEquipmentRecordId, setSelectedEquipmentRecordId] = useState(null);
  const [selectedEquipmentName, setSelectedEquipmentName] = useState("");
  const [historyCompletions, setHistoryCompletions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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

  async function fetchHistoryForEquipment(equipmentRecordId, equipmentName, allCompletions = null) {
    setLoadingHistory(true);
    setError("");
    try {
      // If we already have all completions from grouping, use them
      // Otherwise fetch from API
      let historyData;
      if (allCompletions && Array.isArray(allCompletions)) {
        historyData = allCompletions;
      } else {
        const data = await apiCall(`/equipment-completions?equipment_record_id=${equipmentRecordId}`);
        historyData = Array.isArray(data) ? data : [];
      }
      setHistoryCompletions(historyData);
      setSelectedEquipmentRecordId(equipmentRecordId);
      setSelectedEquipmentName(equipmentName);
      setShowHistoryModal(true);
    } catch (err) {
      const errorMessage = err.message || "Failed to load completion history";
      setError(errorMessage);
      console.error("Error fetching completion history:", err);
      setHistoryCompletions([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  function handleCloseHistoryModal() {
    setShowHistoryModal(false);
    setSelectedEquipmentRecordId(null);
    setSelectedEquipmentName("");
    setHistoryCompletions([]);
  }

  useEffect(() => {
    if (!completions || completions.length === 0) {
      fetchCompletions();
    }
    fetchClients();
    fetchEquipmentTypes();
  }, []);

  // Group completions by equipment_record_id and get the latest one for each
  function groupCompletionsByEquipment(items) {
    const grouped = {};
    
    items.forEach(item => {
      const equipmentId = item.equipment_record_id;
      if (!grouped[equipmentId]) {
        grouped[equipmentId] = {
          completions: [],
          equipment_record_id: equipmentId,
          equipment_name: item.equipment_name,
          equipment_type_id: item.equipment_type_id,
          equipment_type_name: item.equipment_type_name,
          client_id: item.client_id,
          client_name: item.client_name,
          site_id: item.site_id,
          site_name: item.site_name,
          anchor_date: item.anchor_date
        };
      }
      grouped[equipmentId].completions.push(item);
    });
    
    // For each equipment, get the latest completion (most recent completed_at)
    return Object.values(grouped).map(group => {
      // Sort completions by completed_at descending to get the latest first
      const sortedCompletions = [...group.completions].sort((a, b) => {
        const dateA = new Date(a.completed_at).getTime();
        const dateB = new Date(b.completed_at).getTime();
        return dateB - dateA;
      });
      
      const latestCompletion = sortedCompletions[0];
      
      return {
        ...latestCompletion,
        completion_count: group.completions.length,
        all_completions: sortedCompletions // Keep all for history modal
      };
    });
  }

  // Filter and sort function
  function filterAndSortItems(items) {
    // First group by equipment to get latest completion for each
    const groupedItems = groupCompletionsByEquipment(items);
    
    return groupedItems
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

  // Show skeleton while loading
  const LoadingSkeleton = () => (
    <div className="card fade-in">
      <div className="card-header">
        <div className="skeleton skeleton-title"></div>
      </div>
      <div style={{ padding: "1rem" }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton skeleton-item"></div>
        ))}
      </div>
    </div>
  );
  
  if (loading && completions.length === 0) return <LoadingSkeleton />;

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
              <li 
                key={completion.equipment_record_id} 
                className="list-item"
                style={{ cursor: "pointer" }}
                onClick={() => fetchHistoryForEquipment(
                  completion.equipment_record_id, 
                  completion.equipment_name,
                  completion.all_completions
                )}
              >
                <div className="list-main">
                  <div className="list-title">
                    {completion.equipment_name || 'Unknown'}
                    {completion.completion_count > 1 && (
                      <span style={{ marginLeft: "0.5rem", fontSize: "0.9rem", color: "#8193A4", fontWeight: "normal" }}>
                        ({completion.completion_count} times)
                      </span>
                    )}
                  </div>
                  <div className="list-subtitle">
                    {completion.equipment_type_name && `Type: ${completion.equipment_type_name} • `}
                    Client: {completion.client_name}
                    {completion.site_name && ` • Site: ${completion.site_name}`}
                    {completion.anchor_date && ` • Previous Anchor: ${formatDate(completion.anchor_date)}`}
                    {` • Previous Due: ${formatDate(completion.due_date)}`}
                    {` • Completed: ${formatDate(completion.completed_at)}`}
                    {completion.completed_by_user && ` • By: ${completion.completed_by_user}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* History Modal */}
      {showHistoryModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(45, 50, 52, 0.9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }} onClick={handleCloseHistoryModal}>
          <div style={{
            backgroundColor: "#D7E5D8",
            padding: "2rem",
            borderRadius: "0.5rem",
            maxWidth: "800px",
            width: "90%",
            maxHeight: "80vh",
            overflow: "auto",
            color: "#2D3234"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ margin: 0, color: "#2D3234" }}>
                Completion History: {selectedEquipmentName}
              </h2>
              <button 
                onClick={handleCloseHistoryModal} 
                style={{ 
                  color: "#2D3234", 
                  border: "1px solid #8193A4",
                  background: "transparent",
                  padding: "0.5rem 1rem",
                  borderRadius: "0.25rem",
                  cursor: "pointer"
                }}
              >
                ✕ Close
              </button>
            </div>

            {loadingHistory ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <p>Loading history...</p>
              </div>
            ) : historyCompletions.length === 0 ? (
              <p className="empty">No completion history found for this equipment</p>
            ) : (
              <div>
                <p style={{ marginBottom: "1rem", color: "#2D3234", fontSize: "0.9rem" }}>
                  Total completions: {historyCompletions.length}
                </p>
                <ul className="list" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                  {historyCompletions.map((completion, index) => (
                    <li key={completion.id} className="list-item">
                      <div className="list-main">
                        <div className="list-title" style={{ fontSize: "1rem", fontWeight: "600" }}>
                          Completion #{historyCompletions.length - index}
                        </div>
                        <div className="list-subtitle" style={{ marginTop: "0.5rem" }}>
                          <div style={{ marginBottom: "0.25rem" }}>
                            <strong>Due Date:</strong> {formatDate(completion.due_date)}
                          </div>
                          <div style={{ marginBottom: "0.25rem" }}>
                            <strong>Completed:</strong> {formatDate(completion.completed_at)}
                          </div>
                          {completion.interval_weeks && (
                            <div style={{ marginBottom: "0.25rem" }}>
                              <strong>Interval:</strong> {completion.interval_weeks} week{completion.interval_weeks !== 1 ? 's' : ''}
                            </div>
                          )}
                          {completion.completed_by_user && (
                            <div style={{ marginBottom: "0.25rem" }}>
                              <strong>Completed By:</strong> {completion.completed_by_user}
                            </div>
                          )}
                          {completion.anchor_date && (
                            <div style={{ marginBottom: "0.25rem" }}>
                              <strong>Previous Anchor Date:</strong> {formatDate(completion.anchor_date)}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

