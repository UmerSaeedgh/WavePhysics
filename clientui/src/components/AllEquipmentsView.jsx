import { useState, useEffect, useRef } from "react";
import { formatDate } from "../utils/formatDate";
import { generateEquipmentPDF } from "../utils/generateEquipmentPDF";
import wavePhysicsLogo from "../assets/image.png";

export default function AllEquipmentsView({ apiCall, setError, allEquipments, setAllEquipments, loading, setLoading, scrollToEquipmentId, onScrollComplete, onNavigateToSchedule, onNavigateToAddEquipment, currentUser, onRefreshCompletions, onRefreshAllCounts, initialClientId, initialSiteId }) {
  const equipmentRefs = useRef({});
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showDoneModal, setShowDoneModal] = useState(false);
  const [doneEquipment, setDoneEquipment] = useState(null);
  const [calculatedDueDate, setCalculatedDueDate] = useState("");
  const [doneInterval, setDoneInterval] = useState("");
  
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(initialClientId || "");
  const [selectedSiteId, setSelectedSiteId] = useState(initialSiteId || "");
  const [selectedEquipmentTypeId, setSelectedEquipmentTypeId] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);

  useEffect(() => {
    if (scrollToEquipmentId && allEquipments.length > 0) {
      const equipmentExists = allEquipments.some(e => e.id === scrollToEquipmentId);
      if (!equipmentExists) {
        if (onScrollComplete) onScrollComplete();
        return;
      }
      
      setTimeout(() => {
        const equipmentElement = equipmentRefs.current[scrollToEquipmentId];
        if (equipmentElement) {
          equipmentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          equipmentElement.style.backgroundColor = '#8193A4';
          setTimeout(() => {
            equipmentElement.style.backgroundColor = '';
            if (onScrollComplete) onScrollComplete();
          }, 2000);
        } else {
          setTimeout(() => {
            const retryElement = equipmentRefs.current[scrollToEquipmentId];
            if (retryElement) {
              retryElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              retryElement.style.backgroundColor = '#8193A4';
              setTimeout(() => {
                retryElement.style.backgroundColor = '';
                if (onScrollComplete) onScrollComplete();
              }, 2000);
            } else if (onScrollComplete) {
              onScrollComplete();
            }
          }, 300);
        }
      }, 200);
    }
  }, [scrollToEquipmentId, allEquipments, onScrollComplete]);

  async function fetchAllEquipments() {
    setLoading(true);
    setError("");
    try {
      const data = await apiCall("/equipment-records");
      setAllEquipments(data || []);
    } catch (err) {
      const errorMsg = err.message || "Failed to fetch equipments";
      if (!errorMsg.includes("404") && !errorMsg.includes("No equipments")) {
        setError(errorMsg);
      }
      setAllEquipments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAllEquipments();
    fetchClients();
    fetchEquipmentTypes();
  }, []);

  // Update filters when initial props change (e.g., when navigating from ClientSitesView)
  useEffect(() => {
    if (initialClientId !== undefined) {
      setSelectedClientId(initialClientId || "");
    }
    if (initialSiteId !== undefined) {
      setSelectedSiteId(initialSiteId || "");
    }
    // Show filters if initial values are provided
    if (initialClientId || initialSiteId) {
      setShowFilters(true);
    }
  }, [initialClientId, initialSiteId]);

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

  const filteredAndSortedEquipments = allEquipments
    .filter(equipment => {
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        if (!equipment.equipment_name?.toLowerCase().startsWith(searchLower)) {
          return false;
        }
      }
      
      if (selectedClientId) {
        if (equipment.client_id !== parseInt(selectedClientId)) {
          return false;
        }
      }
      
      if (selectedSiteId) {
        if (equipment.site_id !== parseInt(selectedSiteId)) {
          return false;
        }
      }
      
      if (selectedEquipmentTypeId) {
        if (equipment.equipment_type_id !== parseInt(selectedEquipmentTypeId)) {
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
      }
      return 0;
    });

  async function handleDeleteEquipment(equipmentId) {
    if (!window.confirm("Delete this equipment record?")) return;
    try {
      await apiCall(`/equipment-records/${equipmentId}`, { method: "DELETE" });
      await fetchAllEquipments();
      // Refresh all counts
      if (onRefreshAllCounts) {
        onRefreshAllCounts();
      }
    } catch (err) {
      // error already set
    }
  }

  function getTodayDate() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  function calculateDueDate(completionDate, intervalWeeks) {
    if (!completionDate || !intervalWeeks) return "";
    const completion = new Date(completionDate);
    const intervalDays = parseInt(intervalWeeks) * 7;
    
    // Simple rule: Next due date = last completed test date + interval
    const newDate = new Date(completion);
    newDate.setDate(newDate.getDate() + intervalDays);
    return newDate.toISOString().split('T')[0];
  }

  function handleDoneClick(equipment) {
    setDoneEquipment(equipment);
    const initialInterval = equipment.interval_weeks?.toString() || "";
    setDoneInterval(initialInterval);
    
    // Use today's date (completion date) + interval for next due date
    const today = getTodayDate();
    if (initialInterval) {
      setCalculatedDueDate(calculateDueDate(today, initialInterval));
    } else {
      setCalculatedDueDate("");
    }
    setShowDoneModal(true);
  }

  function handleIntervalChange(newInterval) {
    setDoneInterval(newInterval);
    // Recalculate using today's date (completion date) + new interval
    const today = getTodayDate();
    if (newInterval) {
      setCalculatedDueDate(calculateDueDate(today, newInterval));
    }
  }

  async function handleSaveDone() {
    if (!doneEquipment || !calculatedDueDate) {
      setError("Due date is required");
      return;
    }
    try {
      // Get the previous due date (before updating)
      const previousDueDate = doneEquipment.due_date;
      
      // Create a completion record with the PREVIOUS due date (the one that was completed)
      await apiCall("/equipment-completions", {
        method: "POST",
        body: JSON.stringify({
          equipment_record_id: doneEquipment.id,
          due_date: previousDueDate, // Use the old due_date, not the new calculated one
          interval_weeks: doneInterval ? parseInt(doneInterval) : doneEquipment.interval_weeks
        })
      });
      
      // Now update the equipment record with the new calculated due date
      const updatePayload = {
        due_date: calculatedDueDate
      };
      if (doneInterval && parseInt(doneInterval) !== doneEquipment.interval_weeks) {
        updatePayload.interval_weeks = parseInt(doneInterval);
      }
      
      await apiCall(`/equipment-records/${doneEquipment.id}`, {
        method: "PUT",
        body: JSON.stringify(updatePayload)
      });
      
      // Refresh completions count in navigation
      if (onRefreshCompletions) {
        onRefreshCompletions();
      }
      
      await fetchAllEquipments();
      setShowDoneModal(false);
      setDoneEquipment(null);
      setCalculatedDueDate("");
      setDoneInterval("");
    } catch (err) {
      // error already set
    }
  }

  function handleCancelDone() {
    setShowDoneModal(false);
    setDoneEquipment(null);
    setCalculatedDueDate("");
    setDoneInterval("");
  }

  const activeFilterCount = [
    searchTerm,
    selectedClientId,
    selectedSiteId,
    selectedEquipmentTypeId
  ].filter(Boolean).length;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>All Equipments ({filteredAndSortedEquipments.length})</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button 
              className="secondary" 
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? "Hide Filters" : `Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button className="primary" onClick={() => {
              if (onNavigateToAddEquipment) {
                onNavigateToAddEquipment(null);
              }
            }}>
              + Add New Equipment
            </button>
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
                  setSortBy("name");
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

        <div style={{ padding: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "1rem" }}>
            <button className="secondary" onClick={fetchAllEquipments}>Refresh</button>
          </div>
          {loading && allEquipments.length === 0 ? (
            <div style={{ padding: "2rem" }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skeleton skeleton-item" style={{ marginBottom: "1rem" }}></div>
              ))}
            </div>
          ) : allEquipments.length === 0 ? (
            <p className="empty">No equipments found</p>
          ) : filteredAndSortedEquipments.length === 0 ? (
            <p className="empty">No equipments match your filters.</p>
          ) : (
            <ul className="list">
              {filteredAndSortedEquipments.map(equipment => {
                const isActive = equipment.active === true || equipment.active === 1 || equipment.active === "1";
                const isAdmin = Boolean(currentUser && (currentUser.is_admin === true || currentUser.is_admin === 1));
                const isInactive = !isActive && isAdmin;
                
                return (
                  <li 
                    key={equipment.id} 
                    ref={el => equipmentRefs.current[equipment.id] = el}
                    className={isInactive ? "list-item inactive-equipment" : "list-item"}
                    style={isInactive ? {
                      cursor: "pointer",
                      backgroundColor: "#d3d3d3",
                      border: "3px solid #d32f2f",
                      borderLeft: "8px solid #d32f2f",
                      opacity: 0.8
                    } : { cursor: "pointer" }}
                    onClick={() => {
                      setSelectedEquipment(equipment);
                      setShowDetailsModal(true);
                    }}
                  >
                    <div className="list-main" style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                        <div className="list-title" style={isInactive ? { color: "#666", textDecoration: "line-through" } : {}}>
                          {equipment.equipment_name || `Equipment ID: ${equipment.id}`}
                          {isInactive && (
                            <span style={{ 
                              marginLeft: "0.5rem", 
                              fontSize: "0.9rem", 
                              color: "#d32f2f", 
                              fontWeight: "bold",
                              textDecoration: "none",
                              fontStyle: "italic"
                            }}>
                              (inactive)
                            </span>
                          )}
                        </div>
                        {(equipment.client_name || equipment.site_name) && (
                          <div style={{ 
                            fontSize: "0.9375rem", 
                            fontWeight: 500, 
                            color: "var(--primary)",
                            textAlign: "right",
                            whiteSpace: "nowrap"
                          }}>
                            {equipment.client_name}{equipment.site_name && ` • ${equipment.site_name}`}
                          </div>
                        )}
                      </div>
                      <div className="list-subtitle" style={isInactive ? { color: "#666" } : {}}>
                        {equipment.equipment_type_name && `Type: ${equipment.equipment_type_name} • `}
                        Anchor: {formatDate(equipment.anchor_date)}
                        {equipment.due_date && ` • Due: ${formatDate(equipment.due_date)}`}
                        {equipment.interval_weeks && ` • Interval: ${equipment.interval_weeks} weeks`}
                      </div>
                    </div>
                    <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleDoneClick(equipment)}>Done</button>
                      {isAdmin && (
                        <button className="danger" onClick={() => handleDeleteEquipment(equipment.id)}>Delete</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {showDetailsModal && selectedEquipment && (
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
        }} onClick={() => setShowDetailsModal(false)}>
          <div style={{
            backgroundColor: "#D7E5D8",
            padding: "2rem",
            borderRadius: "0.5rem",
            maxWidth: "800px",
            maxHeight: "80vh",
            overflow: "auto",
            width: "90%",
            color: "#2D3234"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ margin: 0, color: "#2D3234" }}>Equipment Details</h2>
              <button onClick={() => setShowDetailsModal(false)} style={{ color: "#2D3234", border: "1px solid #8193A4" }}>✕</button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Equipment Information</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.9rem" }}>
                  <div><strong>Equipment Name:</strong> {selectedEquipment.equipment_name || "N/A"}</div>
                  <div><strong>Equipment Type:</strong> {selectedEquipment.equipment_type_name || "N/A"}</div>
                  {selectedEquipment.make_model_serial && <div style={{ gridColumn: "1 / -1" }}><strong>Make/Model/Serial Number:</strong> {selectedEquipment.make_model_serial}</div>}
                  <div><strong>Anchor Date:</strong> {formatDate(selectedEquipment.anchor_date)}</div>
                  {selectedEquipment.due_date && <div><strong>Due Date:</strong> {formatDate(selectedEquipment.due_date)}</div>}
                  {selectedEquipment.interval_weeks && <div><strong>Interval:</strong> {selectedEquipment.interval_weeks} weeks</div>}
                  {selectedEquipment.lead_weeks && <div><strong>Lead Weeks:</strong> {selectedEquipment.lead_weeks}</div>}
                  {selectedEquipment.timezone && <div><strong>Timezone:</strong> {selectedEquipment.timezone}</div>}
                  <div><strong>Status:</strong> {selectedEquipment.active ? "Active" : "Inactive"}</div>
                  {selectedEquipment.notes && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <strong>Notes:</strong>
                      <div style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>{selectedEquipment.notes}</div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Client Information</h3>
                <div style={{ fontSize: "0.9rem" }}>
                  {selectedEquipment.client_name && <div><strong>Name:</strong> {selectedEquipment.client_name}</div>}
                  {selectedEquipment.client_address && <div><strong>Address:</strong> {selectedEquipment.client_address}</div>}
                  {selectedEquipment.client_billing_info && <div><strong>Billing Info:</strong> {selectedEquipment.client_billing_info}</div>}
                  {selectedEquipment.client_notes && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <strong>Notes:</strong>
                      <div style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>{selectedEquipment.client_notes}</div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Site Information</h3>
                <div style={{ fontSize: "0.9rem" }}>
                  {selectedEquipment.site_name && <div><strong>Name:</strong> {selectedEquipment.site_name}</div>}
                  {selectedEquipment.site_address && <div><strong>Address:</strong> {selectedEquipment.site_address}</div>}
                  {selectedEquipment.site_timezone && <div><strong>Timezone:</strong> {selectedEquipment.site_timezone}</div>}
                  {selectedEquipment.site_notes && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <strong>Notes:</strong>
                      <div style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>{selectedEquipment.site_notes}</div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button 
                  className="primary" 
                  onClick={() => {
                    setShowDetailsModal(false);
                    if (onNavigateToAddEquipment) {
                      onNavigateToAddEquipment(selectedEquipment);
                    }
                  }}
                >
                  Edit Equipment
                </button>
                <button 
                  className="secondary" 
                  onClick={async () => {
                    try {
                      // Fetch completion history
                      const completions = await apiCall(`/equipment-completions?equipment_record_id=${selectedEquipment.id}`);
                      // Load logo image
                      const logoImg = new Image();
                      logoImg.crossOrigin = 'anonymous';
                      await new Promise((resolve, reject) => {
                        logoImg.onload = resolve;
                        logoImg.onerror = reject;
                        logoImg.src = wavePhysicsLogo;
                      });
                      // Generate PDF
                      await generateEquipmentPDF(
                        selectedEquipment, 
                        completions || [], 
                        selectedEquipment.business_name || null,
                        apiCall,
                        logoImg
                      );
                    } catch (err) {
                      setError(err.message || "Failed to generate PDF");
                    }
                  }}
                  style={{ 
                    color: "#2D3234", 
                    border: "1px solid #8193A4",
                    background: "transparent"
                  }}
                >
                  Print PDF
                </button>
                <button 
                  className="secondary" 
                  onClick={() => setShowDetailsModal(false)}
                  style={{ 
                    color: "#2D3234", 
                    border: "1px solid #8193A4",
                    background: "transparent"
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDoneModal && doneEquipment && (
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
        }} onClick={handleCancelDone}>
          <div style={{
            backgroundColor: "#D7E5D8",
            padding: "2rem",
            borderRadius: "0.5rem",
            maxWidth: "500px",
            width: "90%",
            color: "#2D3234"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ margin: 0, color: "#2D3234" }}>Mark as Done</h2>
              <button onClick={handleCancelDone} style={{ color: "#2D3234", border: "1px solid #8193A4" }}>✕</button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "600", color: "#2D3234" }}>
                  Interval (weeks)
                </label>
                <input
                  type="number"
                  value={doneInterval}
                  onChange={(e) => handleIntervalChange(e.target.value)}
                  min="1"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    backgroundColor: "#fff",
                    color: "#2D3234"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "600", color: "#2D3234" }}>
                  Calculated Due Date
                </label>
                <input
                  type="text"
                  value={calculatedDueDate}
                  onChange={(e) => {
                    // Only allow yyyy-mm-dd format
                    const value = e.target.value;
                    // Allow empty or valid yyyy-mm-dd pattern
                    if (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                      setCalculatedDueDate(value);
                    }
                  }}
                  placeholder="yyyy-mm-dd"
                  pattern="\d{4}-\d{2}-\d{2}"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    backgroundColor: "#fff",
                    color: "#2D3234",
                    fontFamily: "monospace"
                  }}
                />
                <div style={{ fontSize: "0.85rem", color: "#8193A4", marginTop: "0.25rem" }}>
                  {doneInterval ? 
                    `Completion Date (${getTodayDate()}) + ${doneInterval} weeks = ${calculatedDueDate || "calculating..."}` :
                    "Enter interval weeks to calculate due date"
                  }
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button 
                  className="primary" 
                  onClick={handleSaveDone}
                  disabled={!calculatedDueDate}
                >
                  Save
                </button>
                <button 
                  className="secondary"
                  onClick={handleCancelDone}
                  style={{ 
                    color: "#2D3234", 
                    border: "1px solid #8193A4",
                    background: "transparent"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

