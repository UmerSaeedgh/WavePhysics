import { useEffect, useState } from "react";
import { formatDate } from "../utils/formatDate";
import { generateEquipmentPDF } from "../utils/generateEquipmentPDF";
import wavePhysicsLogo from "../assets/image.png";

export default function UpcomingView({ apiCall, setError, upcoming, setUpcoming, loading, setLoading, upcomingDate, setUpcomingDate, upcomingInterval, setUpcomingInterval, onNavigateToSchedule, currentUser, overdue, setOverdue, onNavigateToAddEquipment, onRefreshCompletions, onRefreshAllCounts, onBack, initialClientId, initialSiteId, onFilterChange, businesses }) {
  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(initialClientId || "");
  const [selectedSiteId, setSelectedSiteId] = useState(initialSiteId || "");
  const [selectedEquipmentTypeId, setSelectedEquipmentTypeId] = useState("");
  const [sortBy, setSortBy] = useState("due_date"); // "name" or "due_date"
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" or "desc"
  
  // Data for dropdowns
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);

  // Remaining equipment state
  const [remaining, setRemaining] = useState([]);
  const [showRemaining, setShowRemaining] = useState(false);
  const [showOverdue, setShowOverdue] = useState(true);
  const [showUpcoming, setShowUpcoming] = useState(true);

  // Notes editing state
  const [editingNotesId, setEditingNotesId] = useState(null);
  const [editingNotes, setEditingNotes] = useState("");

  // Modal states
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showDoneModal, setShowDoneModal] = useState(false);
  const [doneEquipment, setDoneEquipment] = useState(null);
  const [completionDate, setCompletionDate] = useState("");
  const [calculatedDueDate, setCalculatedDueDate] = useState("");
  const [doneInterval, setDoneInterval] = useState("");

  async function fetchUpcoming() {
    setLoading(true);
    setError("");
    try {
      // Calculate date range
      const startDate = upcomingDate || new Date().toISOString().split('T')[0];
      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + (upcomingInterval * 7));
      const endDate = end.toISOString().split('T')[0];
      
      const upcomingUrl = `/equipment-records/upcoming?start_date=${startDate}&end_date=${endDate}`;
      
      // Fetch all data in parallel for faster loading
      const [overdueData, upcomingData, allRecords] = await Promise.all([
        apiCall("/equipment-records/overdue").catch(() => []),
        apiCall(upcomingUrl).catch(() => []),
        apiCall("/equipment-records?active_only=true").catch(() => [])
      ]);
      
      const overdueArray = Array.isArray(overdueData) ? overdueData : [];
      const upcomingArray = Array.isArray(upcomingData) ? upcomingData : [];
      const allRecordsArray = Array.isArray(allRecords) ? allRecords : [];
      
      setOverdue(overdueArray);
      setUpcoming(upcomingArray);
      
      // Get IDs of overdue and upcoming items
      const overdueIds = new Set(overdueArray.map(item => item.id));
      const upcomingIds = new Set(upcomingArray.map(item => item.id));
      
      // Filter remaining: items that are not overdue and not upcoming
      const remainingItems = allRecordsArray.filter(item => {
        return !overdueIds.has(item.id) && !upcomingIds.has(item.id);
      });
      
      setRemaining(remainingItems);
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

  function getTodayDate() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  function calculateDueDate(completionDateStr, intervalWeeks) {
    if (!completionDateStr || !intervalWeeks) return "";
    const completion = new Date(completionDateStr);
    const intervalDays = parseInt(intervalWeeks) * 7;
    
    // Simple rule: Next due date = last completed test date + interval
    const newDate = new Date(completion);
    newDate.setDate(newDate.getDate() + intervalDays);
    return newDate.toISOString().split('T')[0];
  }

  function recalculateDueDate(completionDateStr, intervalWeeks) {
    const calculated = calculateDueDate(completionDateStr, intervalWeeks);
    setCalculatedDueDate(calculated);
  }

  function handleDoneClick(equipment) {
    setDoneEquipment(equipment);
    const initialInterval = equipment.interval_weeks?.toString() || "";
    setDoneInterval(initialInterval);
    
    // Set completion date to today by default
    const today = getTodayDate();
    setCompletionDate(today);
    
    // Calculate due date from completion date + interval
    if (initialInterval) {
      recalculateDueDate(today, initialInterval);
    } else {
      setCalculatedDueDate("");
    }
    setShowDoneModal(true);
  }

  function handleCompletionDateChange(newDate) {
    setCompletionDate(newDate);
    // Recalculate due date when completion date changes
    if (newDate && doneInterval) {
      recalculateDueDate(newDate, doneInterval);
    } else {
      setCalculatedDueDate("");
    }
  }

  function handleIntervalChange(newInterval) {
    setDoneInterval(newInterval);
    // Recalculate using completion date + new interval
    if (completionDate && newInterval) {
      recalculateDueDate(completionDate, newInterval);
    } else {
      setCalculatedDueDate("");
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
      
      // Refresh all counts
      if (onRefreshAllCounts) {
        onRefreshAllCounts();
      }
      
      await fetchUpcoming();
      setShowDoneModal(false);
      setDoneEquipment(null);
      setCompletionDate("");
      setCalculatedDueDate("");
      setDoneInterval("");
    } catch (err) {
      // error already set
    }
  }

  function handleCancelDone() {
    setShowDoneModal(false);
    setDoneEquipment(null);
    setCompletionDate("");
    setCalculatedDueDate("");
    setDoneInterval("");
  }

  async function handleDeleteEquipment(equipmentId) {
    if (!window.confirm("Delete this equipment record?")) return;
    try {
      await apiCall(`/equipment-records/${equipmentId}`, { method: "DELETE" });
      await fetchUpcoming();
      // Refresh all counts
      if (onRefreshAllCounts) {
        onRefreshAllCounts();
      }
    } catch (err) {
      // error already set
    }
  }

  async function handleSaveNotes(equipmentId) {
    try {
      const updated = await apiCall(`/equipment-records/${equipmentId}`, {
        method: "PUT",
        body: JSON.stringify({ notes: editingNotes })
      });
      setEditingNotesId(null);
      setEditingNotes("");
      // Update the item in the current lists
      const updateItemInList = (list, setList) => {
        const updatedList = list.map(item => 
          item.id === equipmentId ? { ...item, notes: updated.notes } : item
        );
        setList(updatedList);
      };
      updateItemInList(overdue, setOverdue);
      updateItemInList(upcoming, setUpcoming);
      updateItemInList(remaining, setRemaining);
    } catch (err) {
      // error already set
    }
  }

  function handleStartEditNotes(item) {
    setEditingNotesId(item.id);
    setEditingNotes(item.notes || "");
  }

  function handleCancelEditNotes() {
    setEditingNotesId(null);
    setEditingNotes("");
  }

  function renderEquipmentList(items, className = "", isOverdue = false) {
    const filteredItems = filterAndSortItems(items);
    // Check if user is admin
    const isAdmin = currentUser && (currentUser.is_admin === true || currentUser.is_admin === 1);
    
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
                if (editingNotesId !== item.id) {
                  setSelectedEquipment(item);
                  setShowDetailsModal(true);
                }
              }}
            >
              <div className="list-main" style={{ flex: 1 }}>
                <div className="list-title">
                  {item.equipment_name || 'Unknown'}
                  {item.due_date && (
                    <span style={{ marginLeft: "0.75rem", fontSize: "0.9rem", color: isOverdue ? "#d32f2f" : "#2D3234", fontWeight: "bold" }}>
                      • Due: {formatDate(item.due_date)}
                    </span>
                  )}
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
                </div>
                {editingNotesId === item.id ? (
                  <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "flex-start" }} onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={editingNotes}
                      onChange={(e) => setEditingNotes(e.target.value)}
                      placeholder="Add notes..."
                      style={{
                        flex: 1,
                        padding: "0.5rem",
                        border: "1px solid #8193A4",
                        borderRadius: "0.25rem",
                        fontSize: "0.9rem",
                        minHeight: "60px",
                        resize: "vertical"
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      <button 
                        className="primary" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveNotes(item.id);
                        }}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                      >
                        Save
                      </button>
                      <button 
                        className="secondary" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEditNotes();
                        }}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: "0.5rem" }}>
                    {item.notes ? (
                      <div style={{ fontSize: "0.9rem", color: "#2D3234", fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                        {item.notes}
                      </div>
                    ) : (
                      <button
                        className="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEditNotes(item);
                        }}
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                      >
                        + Add Notes
                      </button>
                    )}
                    {item.notes && (
                      <button
                        className="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEditNotes(item);
                        }}
                        style={{ marginLeft: "0.5rem", padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                      >
                        Edit Notes
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => handleDoneClick(item)}>Done</button>
                {isAdmin && (
                  <button className="danger" onClick={() => handleDeleteEquipment(item.id)}>Delete</button>
                )}
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

  // Update filters when initial props change (e.g., when navigating from ClientSitesView)
  useEffect(() => {
    if (initialClientId !== undefined) {
      setSelectedClientId(initialClientId || "");
    }
    if (initialSiteId !== undefined) {
      setSelectedSiteId(initialSiteId || "");
      // Expand remaining section when navigating from site click
      setShowRemaining(true);
    }
    // Show filters if initial values are provided
    if (initialClientId || initialSiteId) {
      setShowFilters(true);
    }
  }, [initialClientId, initialSiteId]);

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

  // Track if we've initialized to avoid redundant fetches
  const [initialized, setInitialized] = useState(false);

  // Initialize with existing data from props, only fetch if needed
  useEffect(() => {
    if (!initialized) {
      // Use existing data from props immediately
      if (upcoming && upcoming.length > 0) {
        setUpcoming(upcoming);
      }
      if (overdue && overdue.length > 0) {
        setOverdue(overdue);
      }
      
      // Fetch clients and equipment types for filters (needed for dropdowns)
      // Only fetch if we don't have them yet
      if (clients.length === 0) {
        fetchClients();
      }
      if (equipmentTypes.length === 0) {
        fetchEquipmentTypes();
      }
      
      // Always fetch to calculate remaining items (even if we have upcoming/overdue from props)
      // Remaining items need to be calculated from all records
      fetchUpcoming();
      
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  // Fetch data when date/interval changes (but only if initialized)
  useEffect(() => {
    if (initialized) {
      fetchUpcoming();
    }
  }, [upcomingDate, upcomingInterval]);

  // Update filter info when filters change
  useEffect(() => {
    if (onFilterChange) {
      const filterInfo = {
        businessName: null,
        clientName: null,
        siteName: null,
        equipmentTypeName: null
      };

      // Get client name and business name
      if (selectedClientId) {
        const client = clients.find(c => c.id === parseInt(selectedClientId));
        if (client) {
          filterInfo.clientName = client.name;
          // Get business name from client's business_id
          if (client.business_id && businesses) {
            const business = businesses.find(b => b.id === client.business_id);
            if (business) {
              filterInfo.businessName = business.name;
            }
          }
        }
      }

      // Get site name
      if (selectedSiteId) {
        const site = sites.find(s => s.id === parseInt(selectedSiteId));
        if (site) {
          filterInfo.siteName = site.name;
        }
      }

      // Get equipment type name
      if (selectedEquipmentTypeId) {
        const equipmentType = equipmentTypes.find(t => t.id === parseInt(selectedEquipmentTypeId));
        if (equipmentType) {
          filterInfo.equipmentTypeName = equipmentType.name;
        }
      }

      // Only send filter info if at least one filter is applied
      const hasFilters = filterInfo.businessName || filterInfo.clientName || filterInfo.siteName || filterInfo.equipmentTypeName;
      onFilterChange(hasFilters ? filterInfo : null);
    }
  }, [selectedClientId, selectedSiteId, selectedEquipmentTypeId, clients, sites, equipmentTypes, businesses, onFilterChange]);

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
  const filteredRemaining = filterAndSortItems(remaining);
  const totalFilteredCount = filteredOverdue.length + filteredUpcoming.length + (showRemaining ? filteredRemaining.length : 0);

  // Show skeleton only on initial load when there's no data
  const showSkeleton = loading && upcoming.length === 0 && overdue.length === 0;
  
  const LoadingSkeleton = () => (
    <div className="card fade-in">
      <div className="card-header">
        <div className="skeleton skeleton-title"></div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div className="skeleton" style={{ width: "100px", height: "2rem", borderRadius: "0.5rem" }}></div>
          <div className="skeleton" style={{ width: "80px", height: "2rem", borderRadius: "0.5rem" }}></div>
        </div>
      </div>
      <div style={{ padding: "1rem" }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton skeleton-item"></div>
        ))}
      </div>
    </div>
  );

  if (showSkeleton) return <LoadingSkeleton />;

  return (
    <div>
      {onBack && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
          <button className="secondary" onClick={onBack} style={{ padding: "0.5rem 0.75rem", minWidth: "auto" }}>←</button>
        </div>
      )}
      <div className={`card fade-in`} style={{ position: "relative" }}>
        {loading && !showSkeleton && (
          <div style={{ 
            position: "absolute", 
            top: "1rem", 
            right: "1rem", 
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "rgba(255, 255, 255, 0.95)",
            padding: "0.5rem 1rem",
            borderRadius: "0.5rem",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
            border: "1px solid rgba(129, 147, 164, 0.2)"
          }}>
            <div className="loading-spinner"></div>
            <span style={{ fontSize: "0.875rem", color: "#8193A4", fontWeight: 500 }}>Loading...</span>
          </div>
        )}
        <div className="card-header">
          <h2>Upcoming ({loading ? "..." : totalFilteredCount})</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button 
              className="secondary" 
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? "Hide Filters" : `Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button className="secondary" onClick={fetchUpcoming}>Refresh</button>
            {onNavigateToAddEquipment && (
              <button className="primary" onClick={() => {
                if (onNavigateToAddEquipment) {
                  // Pass filter values so they can be pre-selected in AddEquipmentPage
                  onNavigateToAddEquipment({
                    client_id: selectedClientId ? parseInt(selectedClientId) : null,
                    site_id: selectedSiteId ? parseInt(selectedSiteId) : null,
                  });
                }
              }}>
                + Add New Equipment
              </button>
            )}
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
        {filteredOverdue.length === 0 && filteredUpcoming.length === 0 && filteredRemaining.length === 0 ? (
          <p className="empty">
            {overdue.length === 0 && upcoming.length === 0 && remaining.length === 0
              ? "No upcoming equipment records" 
              : "No equipment records match your filters"}
          </p>
        ) : (
          <div>
            {filteredOverdue.length > 0 && (
              <div>
                <div 
                  style={{ 
                    padding: "1rem", 
                    margin: 0, 
                    fontSize: "1rem", 
                    color: "#d32f2f",
                    fontWeight: "bold",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    backgroundColor: showOverdue ? "rgba(211, 47, 47, 0.05)" : "transparent",
                    transition: "background-color 0.2s ease"
                  }}
                  onClick={() => setShowOverdue(!showOverdue)}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#d32f2f", fontWeight: "bold" }}>
                    Overdue ({filteredOverdue.length})
                  </h3>
                  <span style={{ fontSize: "0.875rem", color: "#d32f2f" }}>
                    {showOverdue ? "▼" : "▶"}
                  </span>
                </div>
                {showOverdue && (
                  <div>
                    {renderEquipmentList(overdue, "overdue", true)}
                  </div>
                )}
              </div>
            )}
            {filteredUpcoming.length > 0 && (
              <div>
                <div 
                  style={{ 
                    padding: "1rem", 
                    margin: 0, 
                    fontSize: "1rem", 
                    color: "#2D3234",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderTop: filteredOverdue.length > 0 ? "1px solid #ddd" : "none",
                    backgroundColor: showUpcoming ? "rgba(129, 147, 164, 0.05)" : "transparent",
                    transition: "background-color 0.2s ease"
                  }}
                  onClick={() => setShowUpcoming(!showUpcoming)}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#2D3234" }}>
                    Upcoming ({filteredUpcoming.length})
                  </h3>
                  <span style={{ fontSize: "0.875rem", color: "#8193A4" }}>
                    {showUpcoming ? "▼" : "▶"}
                  </span>
                </div>
                {showUpcoming && (
                  <div>
                    {renderEquipmentList(upcoming, "planned", false)}
                  </div>
                )}
              </div>
            )}
            {filteredRemaining.length > 0 && (
              <div>
                <div 
                  style={{ 
                    padding: "1rem", 
                    margin: 0, 
                    fontSize: "1rem", 
                    color: "#2D3234",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderTop: filteredOverdue.length > 0 || filteredUpcoming.length > 0 ? "1px solid #ddd" : "none",
                    backgroundColor: showRemaining ? "rgba(129, 147, 164, 0.05)" : "transparent",
                    transition: "background-color 0.2s ease"
                  }}
                  onClick={() => setShowRemaining(!showRemaining)}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#2D3234" }}>
                    Remaining ({filteredRemaining.length})
                  </h3>
                  <span style={{ fontSize: "0.875rem", color: "#8193A4" }}>
                    {showRemaining ? "▼" : "▶"}
                  </span>
                </div>
                {showRemaining && (
                  <div>
                    {renderEquipmentList(remaining, "remaining", false)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
                  Completion Date
                </label>
                <input
                  type="date"
                  value={completionDate}
                  onChange={(e) => handleCompletionDateChange(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    backgroundColor: "#fff",
                    color: "#2D3234"
                  }}
                />
                <div style={{ fontSize: "0.85rem", color: "#8193A4", marginTop: "0.25rem" }}>
                  Select the date when the test was completed. Default is today.
                </div>
              </div>

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
                  Calculated Due Date (Read-only)
                </label>
                <input
                  type="text"
                  value={calculatedDueDate || ""}
                  readOnly
                  placeholder="Will be calculated automatically"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    backgroundColor: "#f5f5f5",
                    color: "#2D3234",
                    fontFamily: "monospace",
                    cursor: "not-allowed"
                  }}
                />
                <div style={{ fontSize: "0.85rem", color: "#8193A4", marginTop: "0.25rem" }}>
                  {completionDate && doneInterval ? 
                    `Calculation: ${completionDate} + ${doneInterval} weeks = ${calculatedDueDate || "calculating..."}` :
                    "Select completion date and interval to calculate due date"
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

