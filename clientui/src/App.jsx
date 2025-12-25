import { useEffect, useState, useRef } from "react";
import "./App.css";
import wavePhysicsLogo from "./assets/image.png";
import { API_BASE } from "./config";

// Helper function to format dates to yyyy-mm-dd
function formatDate(dateString) {
  if (!dateString) return "";
  try {
    // If already in yyyy-mm-dd format, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return dateString;
    }
    // Try to parse and format
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (e) {
    return dateString;
  }
}

function App() {
  const [view, setView] = useState("clients"); // "clients", "client-sites", "all-equipments", "upcoming", "overdue", "admin", "add-equipment", "edit-client", "edit-site", "edit-contact"
  const [equipmentToEdit, setEquipmentToEdit] = useState(null); // Equipment record to edit when navigating to add-equipment page
  const [clientToEdit, setClientToEdit] = useState(null); // Client to edit when navigating to edit-client page
  const [siteToEdit, setSiteToEdit] = useState(null); // Site to edit when navigating to edit-site page
  const [contactToEdit, setContactToEdit] = useState(null); // Contact link to edit when navigating to edit-contact page
  const [contactContext, setContactContext] = useState(null); // { site, client } context for contact editing
  const [previousView, setPreviousView] = useState(null); // Track previous view to return to after add-equipment
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedSite, setSelectedSite] = useState(null);
  const [scrollToEquipmentId, setScrollToEquipmentId] = useState(null); // Equipment record ID to scroll to in all-equipments view
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [contactLinks, setContactLinks] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [clientEquipments, setClientEquipments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // State for all-equipments, upcoming, and overdue views
  const [allEquipments, setAllEquipments] = useState([]);
  const [dueThisMonth, setDueThisMonth] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingStartDate, setUpcomingStartDate] = useState("");
  const [upcomingEndDate, setUpcomingEndDate] = useState("");

  useEffect(() => {
    fetchClients();
    fetchEquipmentTypes();
    // Fetch counts silently (without showing loading state)
    fetchAllEquipments(true);
    fetchUpcoming(true);
    fetchOverdue(true);
  }, []);

  // Fetch sites when a client is selected
  useEffect(() => {
    if (selectedClient) {
      fetchSites(selectedClient.id);
      fetchClientEquipments(selectedClient.id);
    }
  }, [selectedClient]);

  // Fetch site details when a site is selected
  useEffect(() => {
    if (selectedSite) {
      fetchSiteContacts(selectedSite.id);
    }
  }, [selectedSite]);

  // Note: AllEquipmentsView handles its own data fetching, so we don't need to fetch here
  // This useEffect is kept for potential future use but currently disabled
  // useEffect(() => {
  //   if (view === "all-equipments") {
  //     fetchAllEquipments();
  //   }
  // }, [view]);

  // Fetch data when upcoming view is selected
  useEffect(() => {
    if (view === "upcoming") {
      fetchUpcoming();
    }
  }, [view, upcomingStartDate, upcomingEndDate]);

  // Fetch data when overdue view is selected
  useEffect(() => {
    if (view === "overdue") {
      fetchOverdue();
    }
  }, [view]);

  async function fetchOverdue(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const data = await apiCall("/equipment-records/overdue").catch(() => []);
      setOverdue(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMessage = err.message || "Failed to load data";
      if (!silent) setError(errorMessage);
      if (!silent) console.error("Error fetching data:", err);
      setOverdue([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function fetchSiteContacts(siteId) {
    try {
      const data = await apiCall(`/contacts/rollup/site/${siteId}`);
      setContactLinks(data || []);
    } catch (err) {
      setContactLinks([]);
    }
  }

  // API Functions
  async function apiCall(endpoint, options = {}) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: { "Content-Type": "application/json", ...options.headers },
        ...options,
      });
      
      // Handle 204 No Content (DELETE responses) before checking ok
      if (res.status === 204) {
        return null;
      }
      
      if (!res.ok) {
        const text = await res.text();
        const errorMsg = text || `HTTP ${res.status}: ${res.statusText}`;
        throw new Error(errorMsg);
      }
      
      // Check if response has content before parsing JSON
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const text = await res.text();
        if (text && text.trim()) {
          return JSON.parse(text);
        }
        return null;
      }
      
      // For non-JSON responses, return null
      return null;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      setError(err.message);
      throw err;
    }
  }

  async function fetchClients() {
    setLoading(true);
    try {
      const data = await apiCall("/clients");
      if (Array.isArray(data)) {
        setClients(data);
      } else {
        console.warn("Expected array but got:", data);
        setClients([]);
      }
    } catch (err) {
      console.error("Error fetching clients:", err);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSites(clientId = null) {
    setLoading(true);
    try {
      // Ensure clientId is a valid number or null
      const validClientId = clientId && typeof clientId === 'number' ? clientId : 
                           (clientId && !isNaN(parseInt(clientId)) ? parseInt(clientId) : null);
      const endpoint = validClientId ? `/sites?client_id=${validClientId}` : "/sites";
      const data = await apiCall(endpoint);
      setSites(data);
    } catch (err) {
      // error already set
    } finally {
      setLoading(false);
    }
  }

  async function fetchContacts() {
    setLoading(true);
    try {
      const data = await apiCall("/contacts");
      setContacts(data);
    } catch (err) {
      // error already set
    } finally {
      setLoading(false);
    }
  }

  async function fetchContactLinks(scope = null, scopeId = null) {
    try {
      let endpoint = "/contact-links";
      const params = [];
      // Validate scope is a string, not an object
      if (scope && typeof scope === 'string' && (scope === 'CLIENT' || scope === 'SITE')) {
        params.push(`scope=${scope}`);
      }
      // Validate scopeId is a number
      if (scopeId && (typeof scopeId === 'number' || !isNaN(parseInt(scopeId)))) {
        params.push(`scope_id=${typeof scopeId === 'number' ? scopeId : parseInt(scopeId)}`);
      }
      if (params.length) endpoint += "?" + params.join("&");
      const data = await apiCall(endpoint);
      setContactLinks(data || []);
    } catch (err) {
      // error already set
      setContactLinks([]);
    }
  }

  async function fetchSiteContacts(siteId) {
    try {
      const data = await apiCall(`/contacts/rollup/site/${siteId}`);
      setContactLinks(data || []);
    } catch (err) {
      setContactLinks([]);
    }
  }

  async function fetchEquipmentTypes() {
    setLoading(true);
    try {
      const data = await apiCall("/equipment-types");
      setEquipmentTypes(data);
    } catch (err) {
      // error already set
    } finally {
      setLoading(false);
    }
  }

  async function fetchClientEquipments(clientId) {
    if (!clientId) {
      setClientEquipments([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiCall(`/clients/${clientId}/equipments`);
      setClientEquipments(data || []);
    } catch (err) {
      // error already set
      setClientEquipments([]);
    } finally {
      setLoading(false);
    }
  }


  async function fetchAllEquipments(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError(""); // Clear any previous errors before fetching
    try {
      const data = await apiCall("/equipment-records");
      setAllEquipments(data || []);
    } catch (err) {
      // Only set error if it's a real error, not just empty response
      const errorMsg = err.message || "Failed to fetch equipments";
      if (!silent && !errorMsg.includes("404") && !errorMsg.includes("No equipments")) {
        setError(errorMsg);
      }
      setAllEquipments([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function fetchUpcoming(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      let url = "/equipment-records/upcoming";
      
      if (upcomingStartDate) {
        let endDate = upcomingEndDate;
        // If start date is set but no end date, use start date + 14 days
        if (!endDate) {
          const startDate = new Date(upcomingStartDate);
          startDate.setDate(startDate.getDate() + 14); // Add 14 days
          endDate = startDate.toISOString().split('T')[0];
        }
        url += `?start_date=${upcomingStartDate}&end_date=${endDate}`;
      } else {
        // Default to 2 weeks from today
        url += "?weeks=2";
      }
      
      const data = await apiCall(url).catch(() => []);
      setUpcoming(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMessage = err.message || "Failed to load upcoming data";
      if (!silent) setError(errorMessage);
      if (!silent) console.error("Error fetching upcoming data:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center" }}>
          <img 
            src={wavePhysicsLogo} 
            alt="WAVE PHYSICS" 
            className="logo"
            style={{ height: "50px", maxWidth: "200px", objectFit: "contain" }}
          />
        </div>
        <nav className="breadcrumb" style={{ padding: "0.5rem 1rem", backgroundColor: "#8193A4", color: "#2D3234", borderRadius: "0.5rem" }}>
          <button
            onClick={() => {
              setView("clients");
              setSelectedClient(null);
              setSelectedSite(null);
            }}
            style={{ background: "none", border: "none", color: "#2D3234", cursor: "pointer", marginRight: "0.5rem", fontWeight: "600" }}
          >
            Clients
          </button>
          {selectedClient && (
            <>
              <span style={{ margin: "0 0.5rem", color: "#2D3234" }}>/</span>
          <button
                onClick={() => {
                  setView("client-sites");
                  setSelectedSite(null);
                }}
                style={{ background: "none", border: "none", color: "#2D3234", cursor: "pointer", marginRight: "0.5rem", fontWeight: "600" }}
              >
                {selectedClient.name}
          </button>
            </>
          )}
          {selectedSite && (
            <>
              <span style={{ margin: "0 0.5rem", color: "#2D3234" }}>/</span>
              <span style={{ color: "#2D3234" }}>{selectedSite.name}</span>
            </>
          )}
        </nav>
        <nav className="tabs" style={{ marginTop: "0" }}>
          <button
            className={view === "clients" ? "active" : ""}
            onClick={() => {
              setView("clients");
              setSelectedClient(null);
              setSelectedSite(null);
            }}
          >
            Clients ({clients.length})
          </button>
          <button
            className={view === "all-equipments" ? "active" : ""}
            onClick={() => setView("all-equipments")}
          >
            All Equipments ({allEquipments.length})
          </button>
          <button
            className={view === "upcoming" ? "active" : ""}
            onClick={() => setView("upcoming")}
          >
            Upcoming ({upcoming.length})
          </button>
          <button
            className={view === "overdue" ? "active" : ""}
            onClick={() => setView("overdue")}
          >
            Overdue ({overdue.length})
          </button>
          <button
            className={view === "admin" ? "active" : ""}
            onClick={() => setView("admin")}
          >
            Admin
          </button>
        </nav>
      </header>

      <main className="main-content">
        {error && (
          <div className="error-banner" onClick={() => setError("")}>
            {error} (click to dismiss)
          </div>
        )}

        {view === "clients" && (
          <ClientsListView
            clients={clients}
            onRefresh={fetchClients}
            onClientClick={(client) => {
              setClientToEdit(client);
              setPreviousView("clients");
              setView("edit-client");
            }}
            onViewSites={(client) => {
              setSelectedClient(client);
              setView("client-sites");
            }}
            onAddClient={() => {
              setClientToEdit(null);
              setPreviousView("clients");
              setView("edit-client");
            }}
            apiCall={apiCall}
            setError={setError}
          />
        )}

        {view === "edit-client" && (
          <EditClientPage
            apiCall={apiCall}
            setError={setError}
            clientToEdit={clientToEdit}
            previousView={previousView}
            onBack={() => {
              const returnView = previousView || "clients";
              setClientToEdit(null);
              setPreviousView(null);
              setView(returnView);
            }}
            onSuccess={async () => {
              const returnView = previousView || "clients";
              setClientToEdit(null);
              setPreviousView(null);
              setView(returnView);
              await fetchClients();
            }}
          />
        )}

        {view === "client-sites" && selectedClient && (
          <ClientSitesView
            client={selectedClient}
            sites={sites}
            clientEquipments={clientEquipments}
            onRefreshSites={() => fetchSites(selectedClient.id)}
            onRefreshEquipments={() => fetchClientEquipments(selectedClient.id)}
            onSiteClick={async (site) => {
              setSiteToEdit(site);
              setPreviousView("client-sites");
              setView("edit-site");
              // Fetch contacts for the site
              await fetchSiteContacts(site.id);
            }}
            onAddSite={() => {
              setSiteToEdit(null);
              setPreviousView("client-sites");
              setView("edit-site");
            }}
            onEditSite={async (site) => {
              setSiteToEdit(site);
              setPreviousView("client-sites");
              setView("edit-site");
              // Fetch contacts for the site
              await fetchSiteContacts(site.id);
            }}
            onBack={() => {
              setView("clients");
              setSelectedClient(null);
            }}
            apiCall={apiCall}
            setError={setError}
          />
        )}

        {view === "edit-site" && selectedClient && (
          <EditSitePage
            apiCall={apiCall}
            setError={setError}
            siteToEdit={siteToEdit}
            client={selectedClient}
            contactLinks={contactLinks}
            onRefreshContacts={async () => {
              if (siteToEdit) {
                await fetchSiteContacts(siteToEdit.id);
              }
            }}
            onEditContact={(link) => {
              setContactToEdit(link);
              setContactContext({ site: siteToEdit, client: selectedClient });
              setPreviousView("edit-site");
              setView("edit-contact");
            }}
            onSuccess={async () => {
              setSiteToEdit(null);
              setView("client-sites");
              await fetchSites(selectedClient.id);
            }}
            onBack={() => {
              setSiteToEdit(null);
              setView("client-sites");
            }}
          />
        )}

        {view === "edit-contact" && (
          <EditContactPage
            apiCall={apiCall}
            setError={setError}
            contactToEdit={contactToEdit}
            contactContext={contactContext}
            contactLinks={contactLinks}
            onRefreshContacts={async () => {
              if (contactContext?.site) {
                await fetchSiteContacts(contactContext.site.id);
              }
            }}
            onSuccess={async () => {
              const returnView = previousView || "edit-site";
              const context = contactContext; // Save context before clearing
              setContactToEdit(null);
              setContactContext(null);
              setPreviousView(null);
              setView(returnView);
              // Refresh contacts
              if (context?.site) {
                await fetchSiteContacts(context.site.id);
              }
            }}
            onBack={() => {
              setContactToEdit(null);
              setContactContext(null);
              const returnView = previousView || "edit-site";
              setPreviousView(null);
              setView(returnView);
            }}
          />
        )}

        {view === "all-equipments" && (
          <AllEquipmentsView
            apiCall={apiCall}
            setError={setError}
            allEquipments={allEquipments}
            setAllEquipments={setAllEquipments}
            loading={loading}
            setLoading={setLoading}
            scrollToEquipmentId={scrollToEquipmentId}
            onScrollComplete={() => setScrollToEquipmentId(null)}
            onNavigateToSchedule={async (equipmentRecordId, siteId) => {
              try {
                // Navigate to all-equipments view and scroll to the equipment
                setScrollToEquipmentId(equipmentRecordId);
                setView("all-equipments");
                // AllEquipmentsView will fetch the data when it mounts
              } catch (err) {
                setError("Failed to navigate to equipment: " + (err.message || "Unknown error"));
              }
            }}
            onNavigateToAddEquipment={(schedule) => {
              setEquipmentToEdit(schedule);
              setPreviousView("all-equipments");
              setView("add-equipment");
            }}
          />
        )}

        {view === "upcoming" && (
          <UpcomingView
            apiCall={apiCall}
            setError={setError}
            upcoming={upcoming}
            setUpcoming={setUpcoming}
            loading={loading}
            setLoading={setLoading}
            upcomingStartDate={upcomingStartDate}
            setUpcomingStartDate={setUpcomingStartDate}
            upcomingEndDate={upcomingEndDate}
            setUpcomingEndDate={setUpcomingEndDate}
            onNavigateToSchedule={async (equipmentRecordId, siteId) => {
              try {
                // Navigate to all-equipments view and scroll to the equipment
                setScrollToEquipmentId(equipmentRecordId);
                setView("all-equipments");
                // AllEquipmentsView will fetch the data when it mounts
              } catch (err) {
                setError("Failed to navigate to equipment: " + (err.message || "Unknown error"));
              }
            }}
          />
        )}

        {view === "overdue" && (
          <OverdueView
            apiCall={apiCall}
            setError={setError}
            overdue={overdue}
            setOverdue={setOverdue}
            loading={loading}
            setLoading={setLoading}
            onNavigateToSchedule={async (equipmentRecordId, siteId) => {
              try {
                // Navigate to all-equipments view and scroll to the equipment
                setScrollToEquipmentId(equipmentRecordId);
                setView("all-equipments");
                // AllEquipmentsView will fetch the data when it mounts
              } catch (err) {
                setError("Failed to navigate to equipment: " + (err.message || "Unknown error"));
              }
            }}
          />
        )}

        {view === "add-equipment" && (
          <AddEquipmentPage
            apiCall={apiCall}
            setError={setError}
            clients={clients}
            sites={sites}
            equipmentToEdit={equipmentToEdit}
            previousView={previousView}
            onBack={() => {
              const returnView = previousView || "all-equipments";
              setEquipmentToEdit(null);
              setPreviousView(null);
              setView(returnView);
            }}
            onSuccess={async () => {
              const returnView = previousView || "all-equipments";
              setEquipmentToEdit(null);
              setPreviousView(null);
              setView(returnView);
              // Refresh data if coming from edit-site
              if (returnView === "edit-site" && siteToEdit) {
                await fetchSiteContacts(siteToEdit.id);
              }
            }}
          />
        )}

        {view === "admin" && (
          <AdminTab apiCall={apiCall} setError={setError} />
        )}

      </main>
    </div>
  );
}

// Clients List View - Main entry point
function ClientsListView({ clients, onRefresh, onClientClick, onViewSites, onAddClient, apiCall, setError }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" or "desc"
  const [showFilters, setShowFilters] = useState(false);

  async function handleDelete(clientId) {
    if (!window.confirm("Delete this client? All associated sites will be deleted.")) return;
    try {
      await apiCall(`/clients/${clientId}`, { method: "DELETE" });
      await onRefresh();
    } catch (err) {
      // error already set
    }
  }

  // Filter and sort clients
  const filteredAndSortedClients = clients
    .filter(client => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      return (
        client.name?.toLowerCase().includes(searchLower) ||
        client.address?.toLowerCase().includes(searchLower) ||
        client.billing_info?.toLowerCase().includes(searchLower) ||
        client.notes?.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      if (sortOrder === "asc") {
        return nameA.localeCompare(nameB);
      } else {
        return nameB.localeCompare(nameA);
      }
    });

  // Count active filters (search term and non-default sort order)
  const activeFilterCount = [searchTerm, sortOrder !== "asc"].filter(Boolean).length;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>Clients ({filteredAndSortedClients.length})</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button 
              className="secondary" 
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? "Hide Filters" : `Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button className="primary" onClick={onAddClient}>+ Add New Client</button>
          </div>
        </div>

        {showFilters && (
          <div style={{ padding: "1rem", borderBottom: "1px solid #8193A4" }}>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Search Clients
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name, address, billing info, or notes..."
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
                      whiteSpace: "nowrap"
                    }}
                  >
                    A-Z
                  </button>
                  <button
                    type="button"
                    className={sortOrder === "desc" ? "primary" : "secondary"}
                    onClick={() => setSortOrder("desc")}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.85rem",
                      whiteSpace: "nowrap"
                    }}
                  >
                    Z-A
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {clients.length === 0 ? (
          <p className="empty">No clients yet. Click "Add New Client" to get started.</p>
        ) : filteredAndSortedClients.length === 0 ? (
          <p className="empty">No clients match your search.</p>
        ) : (
          <ul className="list">
            {filteredAndSortedClients.map(client => (
              <li key={client.id} className="list-item" style={{ cursor: "pointer" }}>
                <div className="list-main" onClick={() => onClientClick(client)}>
                  <div className="list-title">{client.name}</div>
                  <div className="list-subtitle">
                    {client.address && `${client.address} • `}
                    {client.billing_info && `Billing: ${client.billing_info} • `}
                    {client.notes}
                  </div>
                </div>
                <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onViewSites(client)}>Sites</button>
                  <button className="danger" onClick={() => handleDelete(client.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Edit Client Page
function EditClientPage({ apiCall, setError, clientToEdit, previousView, onBack, onSuccess }) {
  const [form, setForm] = useState({
    name: "",
    address: "",
    billing_info: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (clientToEdit) {
      setForm({
        name: clientToEdit.name || "",
        address: clientToEdit.address || "",
        billing_info: clientToEdit.billing_info || "",
        notes: clientToEdit.notes || "",
      });
    }
  }, [clientToEdit]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    setLoading(true);
    try {
      const isEdit = !!clientToEdit;
      const endpoint = isEdit ? `/clients/${clientToEdit.id}` : "/clients";
      const result = await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      
      if (!isEdit && result && result.id) {
        try {
          await apiCall(`/clients/${result.id}/equipments/seed-defaults`, { method: "POST" });
        } catch (seedErr) {
          console.warn("Failed to seed default equipments:", seedErr);
        }
      }
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || "Failed to save client");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>
          ← Back to Clients
        </button>
        <h2 style={{ margin: 0 }}>{clientToEdit ? "Edit Client" : "Add New Client"}</h2>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} style={{ padding: "1rem" }}>
        <label>
          Name *
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
          />
        </label>

        <label>
          Address
          <input
            type="text"
            name="address"
            value={form.address}
            onChange={handleChange}
            placeholder="Client address"
          />
        </label>

        <label>
          Billing Info
          <textarea
            name="billing_info"
            value={form.billing_info}
            onChange={handleChange}
            rows={2}
            placeholder="Billing address, payment terms, etc."
          />
        </label>

        <label>
          Notes
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={3}
          />
        </label>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Saving..." : (clientToEdit ? "Save Changes" : "Create Client")}
          </button>
          <button type="button" className="secondary" onClick={onBack} disabled={loading}>Cancel</button>
        </div>
        </form>
      </div>
    </div>
  );
}

// Edit Site Page
function EditSitePage({ apiCall, setError, siteToEdit, client, contactLinks, onRefreshContacts, onEditContact, onSuccess, onBack }) {
  const [form, setForm] = useState({
    name: "",
    address: "",
    timezone: "America/Chicago",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (siteToEdit) {
      setForm({
        name: siteToEdit.name || "",
        address: siteToEdit.address || "",
        timezone: siteToEdit.timezone || "America/Chicago",
        notes: siteToEdit.notes || "",
      });
      // Fetch contacts when editing a site
      if (onRefreshContacts) {
        onRefreshContacts();
      }
    } else {
      setForm({ name: "", address: "", timezone: "America/Chicago", notes: "" });
    }
  }, [siteToEdit?.id]); // Only depend on siteToEdit.id, not the whole object or onRefreshContacts

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    setLoading(true);
    try {
      const isEdit = !!siteToEdit;
      const endpoint = isEdit ? `/sites/${siteToEdit.id}` : "/sites";
      const payload = { ...form, client_id: client.id };
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || "Failed to save site");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>
          ← Back to Sites
        </button>
        <h2 style={{ margin: 0 }}>{siteToEdit ? "Edit Site" : "Add New Site"}</h2>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Name *
            <input type="text" name="name" value={form.name} onChange={handleChange} required />
          </label>
          <label>
            Address
            <input type="text" name="address" value={form.address} onChange={handleChange} placeholder="Site address" />
          </label>
          <label>
            Timezone
            <input type="text" name="timezone" value={form.timezone} onChange={handleChange} placeholder="America/Chicago" />
          </label>
          <label>
            Notes
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Saving..." : (siteToEdit ? "Save Changes" : "Create Site")}
            </button>
            <button type="button" className="secondary" onClick={onBack} disabled={loading}>Cancel</button>
          </div>
        </form>
      </div>

      {siteToEdit && onEditContact && (
        <div style={{ marginTop: "1rem" }}>
          <ContactManagementSection
            site={siteToEdit}
            client={client}
            contactLinks={contactLinks}
            onRefreshContacts={onRefreshContacts}
            onEditContact={onEditContact}
            apiCall={apiCall}
            setError={setError}
          />
        </div>
      )}
    </div>
  );
}

// Edit Contact Page
function EditContactPage({ apiCall, setError, contactToEdit, contactContext, contactLinks, onRefreshContacts, onSuccess, onBack }) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    role: "",
    is_primary: false,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (contactToEdit) {
      setForm({
        first_name: contactToEdit.first_name || "",
        last_name: contactToEdit.last_name || "",
        email: contactToEdit.email || "",
        phone: contactToEdit.phone || "",
        role: contactToEdit.role || "",
        is_primary: contactToEdit.is_primary || false,
      });
    } else {
      setForm({ first_name: "", last_name: "", email: "", phone: "", role: "", is_primary: false });
    }
  }, [contactToEdit]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("First and last name are required");
      return;
    }

    setLoading(true);
    try {
      const isEdit = !!contactToEdit;
      let contactId;
      
      if (isEdit) {
        // Update existing contact
        const result = await apiCall(`/contacts/${contactToEdit.contact_id}`, {
          method: "PUT",
          body: JSON.stringify({
            first_name: form.first_name,
            last_name: form.last_name,
            email: form.email,
            phone: form.phone,
          }),
        });
        contactId = result.id;
        
        // Update the link if it exists
        if (contactToEdit.id) {
          try {
            await apiCall(`/contact-links/${contactToEdit.id}`, {
              method: "PUT",
              body: JSON.stringify({
                role: form.role,
                is_primary: form.is_primary,
              }),
            });
          } catch (linkErr) {
            console.warn("Failed to update contact link:", linkErr);
            setError(linkErr.message || "Failed to update contact link");
          }
        }
      } else {
        // Create new contact
        const result = await apiCall("/contacts", {
          method: "POST",
          body: JSON.stringify({
            first_name: form.first_name,
            last_name: form.last_name,
            email: form.email,
            phone: form.phone,
          }),
        });
        contactId = result.id;
        
        // Automatically link it to the site/client with role and primary status
        if (contactContext?.site) {
          try {
            await apiCall("/contact-links", {
              method: "POST",
              body: JSON.stringify({
                contact_id: contactId,
                scope: "SITE",
                scope_id: contactContext.site.id,
                role: form.role || "Contact",
                is_primary: form.is_primary,
              }),
            });
          } catch (linkErr) {
            console.warn("Failed to link contact:", linkErr);
          }
        } else if (contactContext?.client) {
          try {
            await apiCall("/contact-links", {
              method: "POST",
              body: JSON.stringify({
                contact_id: contactId,
                scope: "CLIENT",
                scope_id: contactContext.client.id,
                role: form.role || "Contact",
                is_primary: form.is_primary,
              }),
            });
          } catch (linkErr) {
            console.warn("Failed to link contact:", linkErr);
          }
        }
      }
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || "Failed to save contact");
    } finally {
      setLoading(false);
    }
  }

  const contextName = contactContext?.site?.name || contactContext?.client?.name || "Unknown";

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
        <h2 style={{ margin: 0 }}>{contactToEdit ? "Edit Contact" : "Add New Contact"}</h2>
      </div>

      <div className="card">
        <div style={{ padding: "0.5rem 1rem", backgroundColor: "#8193A4", color: "#2D3234", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {contactContext?.site ? `Site: ${contextName}` : contactContext?.client ? `Client: ${contextName}` : ""}
        </div>

        <form onSubmit={handleSubmit} className="form" style={{ padding: "1rem" }}>
          <label>
            First Name *
            <input type="text" name="first_name" value={form.first_name} onChange={handleChange} required />
          </label>
          <label>
            Last Name *
            <input type="text" name="last_name" value={form.last_name} onChange={handleChange} required />
          </label>
          <label>
            Email
            <input type="email" name="email" value={form.email} onChange={handleChange} />
          </label>
          <label>
            Phone
            <input type="tel" name="phone" value={form.phone} onChange={handleChange} />
          </label>
          <label>
            Role
            <input type="text" name="role" value={form.role} onChange={handleChange} placeholder="e.g. Manager, Technician" />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="is_primary" checked={form.is_primary} onChange={handleChange} />
            Primary Contact
          </label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Saving..." : (contactToEdit ? "Save Changes" : "Create Contact")}
            </button>
            <button type="button" className="secondary" onClick={onBack} disabled={loading}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Client Sites View - Shows sites for a selected client
function ClientSitesView({ client, sites, clientEquipments, onRefreshSites, onRefreshEquipments, onSiteClick, onBack, onAddSite, onEditSite, apiCall, setError }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" or "desc"
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    onRefreshSites();
    onRefreshEquipments();
  }, []);

  async function handleDelete(siteId) {
    if (!window.confirm("Delete this site?")) return;
    try {
      await apiCall(`/sites/${siteId}`, { method: "DELETE" });
      await onRefreshSites();
    } catch (err) {
      // error already set
    }
  }

  // Filter and sort sites
  const filteredAndSortedSites = sites
    .filter(site => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      return (
        site.name?.toLowerCase().includes(searchLower) ||
        site.address?.toLowerCase().includes(searchLower) ||
        site.timezone?.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      if (sortOrder === "asc") {
        return nameA.localeCompare(nameB);
      } else {
        return nameB.localeCompare(nameA);
      }
    });

  // Count active filters
  const activeFilterCount = [searchTerm, sortOrder !== "asc"].filter(Boolean).length;

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>← Back to Clients</button>
        <h2 style={{ margin: 0 }}>{client.name} - Sites</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Sites ({filteredAndSortedSites.length})</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button 
              className="secondary" 
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? "Hide Filters" : `Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button className="primary" onClick={onAddSite}>+ Add New Site</button>
          </div>
        </div>

        {showFilters && (
          <div style={{ padding: "1rem", borderBottom: "1px solid #8193A4" }}>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                  Search Sites
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name, address, or timezone..."
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
                      whiteSpace: "nowrap"
                    }}
                  >
                    A-Z
                  </button>
                  <button
                    type="button"
                    className={sortOrder === "desc" ? "primary" : "secondary"}
                    onClick={() => setSortOrder("desc")}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.85rem",
                      whiteSpace: "nowrap"
                    }}
                  >
                    Z-A
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {sites.length === 0 ? (
          <p className="empty">No sites yet. Click "Add New Site" to get started.</p>
        ) : filteredAndSortedSites.length === 0 ? (
          <p className="empty">No sites match your search.</p>
        ) : (
          <ul className="list">
            {filteredAndSortedSites.map(site => (
              <li key={site.id} className="list-item" style={{ cursor: "pointer" }}>
                <div className="list-main" onClick={() => onSiteClick(site)}>
                  <div className="list-title">{site.name}</div>
                  <div className="list-subtitle">
                    {site.address && `${site.address} • `}
                    {site.timezone}
                  </div>
                </div>
                <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="danger" onClick={() => handleDelete(site.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Contact Management Section - Simplified with Add New buttons
function ContactManagementSection({ site, client, contactLinks, onRefreshContacts, onEditContact, apiCall, setError }) {
  async function handleDeleteLink(link) {
    const scope = site ? "SITE" : "CLIENT";
    const scopeId = site ? site.id : client?.id;
    if (!window.confirm("Remove this contact?")) return;
    try {
      const links = await apiCall(`/contact-links?scope=${scope}&scope_id=${scopeId}`);
      const actualLink = links.find(l => 
        l.contact_id === link.contact_id && 
        l.role === link.role &&
        l.scope === scope
      );
      if (actualLink) {
        await apiCall(`/contact-links/${actualLink.id}`, { method: "DELETE" });
        await onRefreshContacts();
      }
    } catch (err) {
      // error already set
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-header">
          <h3>Contacts ({contactLinks.length})</h3>
          <button 
            className="primary" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onEditContact) {
                onEditContact(null);
              }
            }}
          >
            + Add New Contact
          </button>
        </div>

        {contactLinks.length === 0 ? (
          <p className="empty">No contacts linked to this {site ? "site" : "client"}. Click "Add New Contact" to get started.</p>
        ) : (
          <ul className="list">
            {contactLinks.map((link, index) => (
              <li key={link.contact_id || link.id || index} className="list-item">
                <div className="list-main">
                  <div className="list-title">
                    {link.first_name} {link.last_name} - {link.role}
                    {link.is_primary && " (Primary)"}
                  </div>
                  <div className="list-subtitle">
                    {link.scope_name && `${link.scope}: ${link.scope_name} • `}
                    {link.email && `${link.email} • `}
                    {link.phone}
                  </div>
                </div>
                <div className="list-actions">
                  <button 
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (onEditContact) {
                        onEditContact(link);
                      }
                    }}
                  >
                    Edit
                  </button>
                  <button className="danger" onClick={() => handleDeleteLink(link)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Clients Tab (Legacy - kept for reference)
function ClientsTab({ clients, clientEquipments, onRefresh, onFetchClientEquipments, apiCall, setError }) {
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedClientContacts, setSelectedClientContacts] = useState(null);
  const [showEquipments, setShowEquipments] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [equipmentForm, setEquipmentForm] = useState({ name: "", interval_weeks: 52, rrule: "FREQ=WEEKLY;INTERVAL=52", default_lead_weeks: 4 });
  const [form, setForm] = useState({ name: "", address: "", billing_info: "", notes: "" });

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setSelectedClient(null);
    setSelectedClientContacts(null);
    setForm({ name: "", address: "", billing_info: "", notes: "" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    try {
      const isEdit = !!selectedClient;
      const endpoint = isEdit ? `/clients/${selectedClient.id}` : "/clients";
      const result = await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      console.log("API call result:", result);
      // If creating a new client, seed default equipments
      if (!isEdit && result && result.id) {
        try {
          await apiCall(`/clients/${result.id}/equipments/seed-defaults`, { method: "POST" });
        } catch (seedErr) {
          console.warn("Failed to seed default equipments:", seedErr);
          // Don't fail the client creation if seeding fails
        }
      }
      await onRefresh();
      resetForm();
    } catch (err) {
      console.error("Error submitting form:", err);
      setError(err.message || "Failed to save client");
    }
  }

  async function startEdit(client) {
    setSelectedClient(client);
    setForm({ 
      name: client.name || "", 
      address: client.address || "", 
      billing_info: client.billing_info || "", 
      notes: client.notes || "" 
    });
    // Load contacts for this client
    try {
      const contacts = await apiCall(`/contacts/rollup/client/${client.id}`);
      setSelectedClientContacts(contacts);
    } catch (err) {
      setSelectedClientContacts([]);
    }
    // Load equipments for this client
    await onFetchClientEquipments(client.id);
  }

  async function seedDefaultEquipments(clientId) {
    try {
      await apiCall(`/clients/${clientId}/equipments/seed-defaults`, { method: "POST" });
      await onFetchClientEquipments(clientId);
      setError("");
    } catch (err) {
      // error already set
    }
  }

  async function addCustomEquipment(clientId) {
    if (!equipmentForm.name.trim()) {
      setError("Equipment name is required");
      return;
    }
    try {
      const rrule = equipmentForm.rrule || `FREQ=WEEKLY;INTERVAL=${equipmentForm.interval_weeks}`;
      await apiCall(`/clients/${clientId}/equipments`, {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          name: equipmentForm.name,
          interval_weeks: equipmentForm.interval_weeks,
          rrule: rrule,
          default_lead_weeks: equipmentForm.default_lead_weeks,
        }),
      });
      await onFetchClientEquipments(clientId);
      resetEquipmentForm();
      setError("");
    } catch (err) {
      // error already set
    }
  }

  function startEditEquipment(equipment) {
    setSelectedEquipment(equipment);
    setEquipmentForm({
      name: equipment.name,
      interval_weeks: equipment.interval_weeks || 52,
      rrule: equipment.rrule || "FREQ=WEEKLY;INTERVAL=52",
      default_lead_weeks: equipment.default_lead_weeks || 4,
    });
  }

  function resetEquipmentForm() {
    setSelectedEquipment(null);
    setEquipmentForm({ name: "", interval_weeks: 52, rrule: "FREQ=WEEKLY;INTERVAL=52", default_lead_weeks: 4 });
  }

  async function handleEquipmentSubmit(e) {
    e.preventDefault();
    setError("");
    if (!equipmentForm.name.trim()) {
      setError("Equipment name is required");
      return;
    }
    try {
      const isEdit = !!selectedEquipment;
      const endpoint = isEdit ? `/equipments/${selectedEquipment.id}` : `/clients/${selectedClient.id}/equipments`;
      const payload = {
        name: equipmentForm.name,
        interval_weeks: equipmentForm.interval_weeks,
        rrule: equipmentForm.rrule || `FREQ=WEEKLY;INTERVAL=${equipmentForm.interval_weeks || 52}`,
        default_lead_weeks: equipmentForm.default_lead_weeks,
        active: true,
      };
      if (!isEdit) {
        payload.client_id = selectedClient.id;
      }
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onFetchClientEquipments(selectedClient.id);
      resetEquipmentForm();
    } catch (err) {
      // error already set
    }
  }

  async function deleteEquipment(equipmentId, isCustom) {
    if (!isCustom) {
      setError("Cannot delete default equipment");
      return;
    }
    if (!window.confirm("Delete this custom equipment?")) return;
    try {
      await apiCall(`/equipments/${equipmentId}`, { method: "DELETE" });
      await onFetchClientEquipments(selectedClient?.id);
      setError("");
    } catch (err) {
      // error already set
    }
  }
  
  async function loadClientContacts(clientId) {
    try {
      const contacts = await apiCall(`/contacts/rollup/client/${clientId}`);
      setSelectedClientContacts(contacts);
    } catch (err) {
      setSelectedClientContacts([]);
    }
  }
  
  function copyEmailList(contacts) {
    const emails = contacts
      .filter(c => c.email)
      .map(c => c.email)
      .join('; ');
    if (emails) {
      navigator.clipboard.writeText(emails);
      alert('Email list copied to clipboard!');
    } else {
      alert('No email addresses found');
    }
  }

  async function handleDelete(clientId) {
    if (!window.confirm("Delete this client? All associated sites will be deleted.")) return;
    try {
      await apiCall(`/clients/${clientId}`, { method: "DELETE" });
      await onRefresh();
      if (selectedClient?.id === clientId) resetForm();
    } catch (err) {
      // error already set
    }
  }

  return (
    <div className="two-column">
      <div className="card">
        <div className="card-header">
          <h2>{selectedClient ? "Edit Client" : "Add Client"}</h2>
          {selectedClient && (
            <button className="secondary" onClick={resetForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Name *
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Address
            <input
              type="text"
              name="address"
              value={form.address}
              onChange={handleChange}
              placeholder="Client address"
            />
          </label>
          <label>
            Billing Info
            <textarea
              name="billing_info"
              value={form.billing_info}
              onChange={handleChange}
              rows={2}
              placeholder="Billing address, payment terms, etc."
            />
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
            />
          </label>
          <button type="submit" className="primary">
            {selectedClient ? "Save" : "Create"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Clients ({clients.length})</h2>
          <button className="secondary" onClick={onRefresh}>Refresh</button>
        </div>
        {clients.length === 0 ? (
          <p className="empty">No clients yet</p>
        ) : (
          <ul className="list">
            {clients.map(client => (
              <li key={client.id} className="list-item">
                <div className="list-main">
                  <div className="list-title">{client.name}</div>
                  <div className="list-subtitle">
                    {client.address && `${client.address} • `}
                    {client.billing_info && `Billing: ${client.billing_info} • `}
                    {client.notes}
                  </div>
                </div>
                <div className="list-actions">
                  <button onClick={() => startEdit(client)}>Edit</button>
                  <button onClick={() => { startEdit(client); setShowEquipments(true); }}>Equipments</button>
                  <button className="danger" onClick={() => handleDelete(client.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {selectedClientContacts && selectedClientContacts.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #8193A4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Contacts for {clients.find(c => c.id === selectedClient?.id)?.name}</h3>
              <button 
                className="secondary" 
                onClick={() => {
                  const emails = selectedClientContacts
                    .filter(c => c.email)
                    .map(c => c.email)
                    .join('; ');
                  if (emails) {
                    navigator.clipboard.writeText(emails);
                    alert('Email list copied to clipboard!');
                  } else {
                    alert('No email addresses found');
                  }
                }}
                style={{ fontSize: '0.85rem' }}
              >
                Copy Email List
              </button>
            </div>
            <ul className="list">
              {selectedClientContacts.map(contact => (
                <li key={`${contact.contact_id}-${contact.scope}-${contact.role}`} className="list-item" style={{ padding: '0.5rem' }}>
                  <div className="list-main">
                    <div className="list-title">
                      {contact.first_name} {contact.last_name} - {contact.role}
                      {contact.is_primary && " (Primary)"}
                    </div>
                    <div className="list-subtitle">
                      {contact.scope}: {contact.scope_name}
                      {contact.email && ` • ${contact.email}`}
                      {contact.phone && ` • ${contact.phone}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {selectedClient && showEquipments && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #8193A4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Equipments for {clients.find(c => c.id === selectedClient?.id)?.name}</h3>
              <button className="secondary" onClick={() => setShowEquipments(false)}>Close</button>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <button 
                className="secondary" 
                onClick={() => seedDefaultEquipments(selectedClient.id)}
                style={{ marginRight: '0.5rem' }}
              >
                Seed Default Equipments
              </button>
            </div>
            {clientEquipments.length === 0 ? (
              <p className="empty">No equipments. Click "Seed Default Equipments" to add defaults.</p>
            ) : (
              <ul className="list">
                {clientEquipments.map(eq => (
                  <li key={eq.id} className="list-item">
                    <div className="list-main">
                      <div className="list-title">
                        {eq.name} {eq.is_custom ? "(Custom)" : "(Default)"}
                      </div>
                      <div className="list-subtitle">
                        Every {eq.interval_weeks} weeks • Lead: {eq.default_lead_weeks} weeks
                        {!eq.active && " • Inactive"}
                      </div>
                    </div>
                    <div className="list-actions">
                      <button onClick={() => startEditEquipment(eq)}>Edit</button>
                      {eq.is_custom && (
                        <button className="danger" onClick={() => deleteEquipment(eq.id, eq.is_custom)}>Delete</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#8193A4', borderRadius: '0.5rem', color: '#2D3234' }}>
              <h4 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: '#2D3234' }}>{selectedEquipment ? "Edit Equipment" : "Add Custom Equipment"}</h4>
              <form onSubmit={handleEquipmentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Equipment name"
                  value={equipmentForm.name}
                  onChange={(e) => setEquipmentForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                  style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #8193A4' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="number"
                    placeholder="Interval weeks"
                    value={equipmentForm.interval_weeks}
                    onChange={(e) => setEquipmentForm(prev => ({ ...prev, interval_weeks: parseInt(e.target.value) || 52 }))}
                    style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #8193A4', flex: 1 }}
                  />
                  <input
                    type="number"
                    placeholder="Lead weeks"
                    value={equipmentForm.default_lead_weeks}
                    onChange={(e) => setEquipmentForm(prev => ({ ...prev, default_lead_weeks: parseInt(e.target.value) || 4 }))}
                    style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #8193A4', flex: 1 }}
                  />
                </div>
                <input
                  type="text"
                  placeholder="RRule (e.g. FREQ=WEEKLY;INTERVAL=52)"
                  value={equipmentForm.rrule}
                  onChange={(e) => setEquipmentForm(prev => ({ ...prev, rrule: e.target.value }))}
                  style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #8193A4' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    type="submit"
                    className="primary" 
                    style={{ padding: '0.5rem', flex: 1 }}
                  >
                    {selectedEquipment ? "Save" : "Add"} Equipment
                  </button>
                  {selectedEquipment && (
                    <button 
                      type="button"
                      className="secondary" 
                      onClick={resetEquipmentForm}
                      style={{ padding: '0.5rem' }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Sites Tab
function SitesTab({ clients, sites, onRefreshClients, onRefreshSites, apiCall, setError }) {
  const [selectedSite, setSelectedSite] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [form, setForm] = useState({
    client_id: "",
    name: "",
    address: "",
    timezone: "America/Chicago",
    notes: "",
  });

  useEffect(() => {
    onRefreshClients();
    onRefreshSites();
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setSelectedSite(null);
    setForm({
      client_id: selectedClientId || "",
      name: "",
      address: "",
      timezone: "America/Chicago",
      notes: "",
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.client_id) {
      setError("Name and client are required");
      return;
    }

    try {
      const isEdit = !!selectedSite;
      const endpoint = isEdit ? `/sites/${selectedSite.id}` : "/sites";
      const payload = { ...form, client_id: parseInt(form.client_id) };
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onRefreshSites();
        resetForm();
    } catch (err) {
      // error already set
    }
  }

  function startEdit(site) {
    setSelectedSite(site);
    const clientId = typeof site.client_id === 'number' ? site.client_id : parseInt(site.client_id);
    setSelectedClientId(clientId);
    setForm({
      client_id: clientId.toString(),
      name: site.name || "",
      address: site.address || "",
      timezone: site.timezone || "America/Chicago",
      notes: site.notes || "",
    });
  }

  async function handleDelete(siteId) {
    if (!window.confirm("Delete this site?")) return;
    try {
      await apiCall(`/sites/${siteId}`, { method: "DELETE" });
      await onRefreshSites();
      if (selectedSite?.id === siteId) resetForm();
    } catch (err) {
      // error already set
    }
  }

  const filteredSites = selectedClientId
    ? sites.filter(s => s.client_id === selectedClientId)
    : sites;

  return (
    <div className="two-column">
      <div className="card">
        <div className="card-header">
          <h2>{selectedSite ? "Edit Site" : "Add Site"}</h2>
          {selectedSite && (
            <button className="secondary" onClick={resetForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Client *
            <select
              name="client_id"
              value={form.client_id}
              onChange={handleChange}
              required
            >
              <option value="">Select client</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Site Name *
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Address
            <input
              type="text"
              name="address"
              value={form.address}
              onChange={handleChange}
            />
          </label>
          <label>
            Timezone
            <input
              type="text"
              name="timezone"
              value={form.timezone}
              onChange={handleChange}
              placeholder="America/Chicago"
            />
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
            />
          </label>
          <button type="submit" className="primary">
            {selectedSite ? "Save" : "Create"}
          </button>
        </form>
      </div>

      <div className="card">
          <div className="card-header">
          <h2>Sites ({filteredSites.length})</h2>
          <div>
            <select
              value={selectedClientId || ""}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedClientId(value ? parseInt(value) : null);
              }}
              className="filter-select"
            >
              <option value="">All Clients</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="secondary" onClick={() => onRefreshSites()}>Refresh</button>
          </div>
        </div>
        {filteredSites.length === 0 ? (
          <p className="empty">No sites yet</p>
        ) : (
          <ul className="list">
            {filteredSites.map(site => {
              const client = clients.find(c => c.id === site.client_id);
              return (
                <li key={site.id} className="list-item">
                  <div className="list-main">
                    <div className="list-title">{site.name}</div>
                    <div className="list-subtitle">
                      {client?.name} • {site.timezone}
                      {site.address && ` • ${site.address}`}
                    </div>
                  </div>
                  <div className="list-actions">
                    <button onClick={() => startEdit(site)}>Edit</button>
                    <button className="danger" onClick={() => handleDelete(site.id)}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// Contacts Tab
function ContactsTab({
  clients,
  sites,
  contacts,
  contactLinks,
  onRefreshContacts,
  onRefreshLinks,
  onRefreshSites,
  onRefreshClients,
  apiCall,
  setError,
}) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [contactForm, setContactForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });
  const [linkForm, setLinkForm] = useState({
    contact_id: "",
    scope: "CLIENT",
    scope_id: "",
    role: "",
    is_primary: false,
  });

  useEffect(() => {
    onRefreshClients();
    onRefreshSites();
    onRefreshContacts();
    onRefreshLinks();
  }, []);

  function handleContactChange(e) {
    const { name, value, type, checked } = e.target;
    setContactForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  function handleLinkChange(e) {
    const { name, value, type, checked } = e.target;
    setLinkForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  function resetContactForm() {
    setSelectedContact(null);
    setContactForm({ first_name: "", last_name: "", email: "", phone: "" });
  }

  function resetLinkForm() {
    setSelectedLink(null);
    setLinkForm({
      contact_id: "",
      scope: "CLIENT",
      scope_id: "",
      role: "",
      is_primary: false,
    });
  }

  async function handleContactSubmit(e) {
    e.preventDefault();
    setError("");
    if (!contactForm.first_name.trim() || !contactForm.last_name.trim()) {
      setError("First and last name are required");
      return;
    }

    try {
      const isEdit = !!selectedContact;
      const endpoint = isEdit ? `/contacts/${selectedContact.id}` : "/contacts";
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(contactForm),
      });
      await onRefreshContacts();
      resetContactForm();
    } catch (err) {
      // error already set
    }
  }

  async function handleLinkSubmit(e) {
    e.preventDefault();
    setError("");
    if (!linkForm.contact_id || !linkForm.scope_id || !linkForm.role.trim()) {
      setError("Contact, scope, and role are required");
      return;
    }

    try {
      const isEdit = !!selectedLink;
      const endpoint = isEdit ? `/contact-links/${selectedLink.id}` : "/contact-links";
      const payload = {
        ...linkForm,
        contact_id: parseInt(linkForm.contact_id),
        scope_id: parseInt(linkForm.scope_id),
      };
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onRefreshLinks();
      resetLinkForm();
    } catch (err) {
      // error already set
    }
  }

  function startEditContact(contact) {
    setSelectedContact(contact);
    setContactForm({
      first_name: contact.first_name || "",
      last_name: contact.last_name || "",
      email: contact.email || "",
      phone: contact.phone || "",
    });
  }

  function startEditLink(link) {
    setSelectedLink(link);
    setLinkForm({
      contact_id: link.contact_id.toString(),
      scope: link.scope,
      scope_id: link.scope_id.toString(),
      role: link.role || "",
      is_primary: link.is_primary || false,
    });
  }

  async function handleDeleteContact(contactId) {
    if (!window.confirm("Delete this contact?")) return;
    try {
      await apiCall(`/contacts/${contactId}`, { method: "DELETE" });
      await onRefreshContacts();
      await onRefreshLinks();
      if (selectedContact?.id === contactId) resetContactForm();
    } catch (err) {
      // error already set
    }
  }

  async function handleDeleteLink(linkId) {
    if (!window.confirm("Delete this contact link?")) return;
    try {
      await apiCall(`/contact-links/${linkId}`, { method: "DELETE" });
      await onRefreshLinks();
      if (selectedLink?.id === linkId) resetLinkForm();
    } catch (err) {
      // error already set
    }
  }

  const scopeOptions = linkForm.scope === "CLIENT" ? clients : sites;

  return (
    <div className="contacts-layout">
      <div className="card">
        <div className="card-header">
          <h2>{selectedContact ? "Edit Contact" : "Add Contact"}</h2>
          {selectedContact && (
            <button className="secondary" onClick={resetContactForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleContactSubmit} className="form">
          <label>
            First Name *
            <input
              type="text"
              name="first_name"
              value={contactForm.first_name}
              onChange={handleContactChange}
              required
            />
          </label>
          <label>
            Last Name *
            <input
              type="text"
              name="last_name"
              value={contactForm.last_name}
              onChange={handleContactChange}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              name="email"
              value={contactForm.email}
              onChange={handleContactChange}
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              name="phone"
              value={contactForm.phone}
              onChange={handleContactChange}
            />
          </label>
          <button type="submit" className="primary">
            {selectedContact ? "Save" : "Create"}
              </button>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Contact Links</h2>
          {selectedLink && (
            <button className="secondary" onClick={resetLinkForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleLinkSubmit} className="form">
          <label>
            Contact *
            <select
              name="contact_id"
              value={linkForm.contact_id}
              onChange={handleLinkChange}
              required
            >
              <option value="">Select contact</option>
              {contacts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scope *
            <select
              name="scope"
              value={linkForm.scope}
              onChange={handleLinkChange}
              required
            >
              <option value="CLIENT">Client</option>
              <option value="SITE">Site</option>
            </select>
          </label>
          <label>
            {linkForm.scope} *
            <select
              name="scope_id"
              value={linkForm.scope_id}
              onChange={handleLinkChange}
              required
            >
              <option value="">Select {linkForm.scope.toLowerCase()}</option>
              {scopeOptions.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <label>
            Role *
            <input
              type="text"
              name="role"
              value={linkForm.role}
              onChange={handleLinkChange}
              placeholder="e.g. Owner, Billing, RSO, Tech"
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="is_primary"
              checked={linkForm.is_primary}
              onChange={handleLinkChange}
            />
            Primary contact
          </label>
          <button type="submit" className="primary">
            {selectedLink ? "Save" : "Create"}
          </button>
        </form>
          </div>

      <div className="card">
        <div className="card-header">
          <h2>Contacts ({contacts.length})</h2>
          <button className="secondary" onClick={onRefreshContacts}>Refresh</button>
        </div>
        {contacts.length === 0 ? (
          <p className="empty">No contacts yet</p>
        ) : (
          <ul className="list">
            {contacts.map(contact => (
              <li key={contact.id} className="list-item">
                <div className="list-main">
                  <div className="list-title">
                    {contact.first_name} {contact.last_name}
                  </div>
                  <div className="list-subtitle">
                    {contact.email && `${contact.email} • `}
                    {contact.phone}
                  </div>
                </div>
                <div className="list-actions">
                  <button onClick={() => startEditContact(contact)}>Edit</button>
                  <button className="danger" onClick={() => handleDeleteContact(contact.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Contact Links ({contactLinks.length})</h2>
          <button className="secondary" onClick={() => onRefreshLinks()}>Refresh</button>
        </div>
        {contactLinks.length === 0 ? (
          <p className="empty">No contact links yet</p>
        ) : (
          <ul className="list">
            {contactLinks.map(link => {
              const contact = contacts.find(c => c.id === link.contact_id);
              const scopeEntity = link.scope === "CLIENT"
                ? clients.find(c => c.id === link.scope_id)
                : sites.find(s => s.id === link.scope_id);
              return (
                <li key={link.id} className="list-item">
                  <div className="list-main">
                    <div className="list-title">
                      {contact?.first_name} {contact?.last_name} - {link.role}
                      {link.is_primary && " (Primary)"}
                    </div>
                    <div className="list-subtitle">
                      {link.scope}: {scopeEntity?.name}
                    </div>
                  </div>
                  <div className="list-actions">
                    <button onClick={() => startEditLink(link)}>Edit</button>
                    <button className="danger" onClick={() => handleDeleteLink(link.id)}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// Equipments Tab (Legacy Test Types)
function EquipmentTypesTab({ equipmentTypes, onRefresh, apiCall, setError }) {
  const [selectedType, setSelectedType] = useState(null);
  const [form, setForm] = useState({
    name: "",
    interval_weeks: "",
    rrule: "",
    default_lead_weeks: "",
    inactive: false,
  });

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  function resetForm() {
    setSelectedType(null);
    setForm({
      name: "",
      interval_weeks: "",
      rrule: "",
      default_lead_weeks: "",
      inactive: false,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.interval_weeks || !form.rrule || !form.default_lead_weeks) {
      setError("All fields are required");
      return;
    }

    try {
      const isEdit = !!selectedType;
      const endpoint = isEdit ? `/equipment-types/${selectedType.id}` : "/equipment-types";
      const payload = {
        ...form,
        interval_weeks: parseInt(form.interval_weeks),
        default_lead_weeks: parseInt(form.default_lead_weeks),
        active: !form.inactive, // Convert inactive to active for API
      };
      // Remove inactive from payload as API expects active
      delete payload.inactive;
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onRefresh();
      resetForm();
    } catch (err) {
      // error already set
    }
  }

  function startEdit(type) {
    setSelectedType(type);
    setForm({
      name: type.name || "",
      interval_weeks: type.interval_weeks?.toString() || "",
      rrule: type.rrule || "",
      default_lead_weeks: type.default_lead_weeks?.toString() || "",
      inactive: type.active !== undefined ? !type.active : false, // Convert active to inactive for form
    });
  }

  async function handleDelete(typeId) {
    if (!window.confirm("Delete this equipment?")) return;
    try {
      await apiCall(`/equipment-types/${typeId}`, { method: "DELETE" });
      await onRefresh();
      if (selectedType?.id === typeId) resetForm();
    } catch (err) {
      // error already set
    }
  }

  async function handleSeed() {
    try {
      await apiCall("/equipment-types/seed", { method: "POST" });
      await onRefresh();
      setError("");
    } catch (err) {
      // error already set
    }
  }

  return (
    <div className="two-column">
      <div className="card">
        <div className="card-header">
          <h2>{selectedType ? "Edit Equipment" : "Add Equipment"}</h2>
          {selectedType && (
            <button className="secondary" onClick={resetForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="form">
            <label>
            Name *
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
              required
              />
            </label>
          <label>
            Interval (weeks) *
            <input
              type="number"
              name="interval_weeks"
              value={form.interval_weeks}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            RRULE *
            <input
              type="text"
              name="rrule"
              value={form.rrule}
              onChange={handleChange}
              placeholder="FREQ=WEEKLY;INTERVAL=13"
              required
            />
          </label>
          <label>
            Default Lead Weeks *
            <input
              type="number"
              name="default_lead_weeks"
              value={form.default_lead_weeks}
              onChange={handleChange}
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="inactive"
              checked={form.inactive}
              onChange={handleChange}
            />
            Inactive
          </label>
          <button type="submit" className="primary">
            {selectedType ? "Save" : "Create"}
          </button>
        </form>
        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #8193A4" }}>
          <button className="secondary" onClick={handleSeed}>
              Seed Default Equipments
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Equipments ({equipmentTypes.length})</h2>
          <button className="secondary" onClick={onRefresh}>Refresh</button>
        </div>
        {equipmentTypes.length === 0 ? (
          <p className="empty">No equipments yet. Click "Seed Default Equipments" to add defaults.</p>
        ) : (
          <ul className="list">
            {equipmentTypes.map(type => (
              <li key={type.id} className="list-item">
                <div className="list-main">
                  <div className="list-title">{type.name}</div>
                  <div className="list-subtitle">
                    Every {type.interval_weeks} weeks • Lead: {type.default_lead_weeks} weeks
                    {!type.active && " • Inactive"}
                  </div>
                </div>
                <div className="list-actions">
                  <button onClick={() => startEdit(type)}>Edit</button>
                  <button className="danger" onClick={() => handleDelete(type.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Schedules Tab - REMOVED

// Work Orders Tab - REMOVED

// All Equipments View
function AllEquipmentsView({ apiCall, setError, allEquipments, setAllEquipments, loading, setLoading, scrollToEquipmentId, onScrollComplete, onNavigateToSchedule, onNavigateToAddEquipment }) {
  const equipmentRefs = useRef({});
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showDoneModal, setShowDoneModal] = useState(false);
  const [doneEquipment, setDoneEquipment] = useState(null);
  const [calculatedDueDate, setCalculatedDueDate] = useState("");
  const [doneInterval, setDoneInterval] = useState("");
  
  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedEquipmentTypeId, setSelectedEquipmentTypeId] = useState("");
  const [sortBy, setSortBy] = useState("name"); // "name" or "due_date"
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" or "desc"
  
  // Data for dropdowns
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);

  useEffect(() => {
    if (scrollToEquipmentId && allEquipments.length > 0) {
      // Verify the equipment exists in the current list
      const equipmentExists = allEquipments.some(e => e.id === scrollToEquipmentId);
      if (!equipmentExists) {
        // Equipment not found, clear scroll target
        if (onScrollComplete) onScrollComplete();
        return;
      }
      
      // Wait for DOM to update, then scroll
      setTimeout(() => {
        const equipmentElement = equipmentRefs.current[scrollToEquipmentId];
        if (equipmentElement) {
          equipmentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Highlight the equipment briefly
          equipmentElement.style.backgroundColor = '#8193A4';
          setTimeout(() => {
            equipmentElement.style.backgroundColor = '';
            if (onScrollComplete) onScrollComplete();
          }, 2000);
        } else {
          // Element not found yet, try again after a short delay
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
    setError(""); // Clear any previous errors before fetching
    try {
      const data = await apiCall("/equipment-records");
      setAllEquipments(data || []);
    } catch (err) {
      // Only set error if it's a real error, not just empty response
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

  // Filter and sort equipments
  const filteredAndSortedEquipments = allEquipments
    .filter(equipment => {
      // Search by name
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        if (!equipment.equipment_name?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      
      // Filter by client
      if (selectedClientId) {
        if (equipment.client_id !== parseInt(selectedClientId)) {
          return false;
        }
      }
      
      // Filter by site
      if (selectedSiteId) {
        if (equipment.site_id !== parseInt(selectedSiteId)) {
          return false;
        }
      }
      
      // Filter by equipment type
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

  async function handleDeleteEquipment(equipmentId) {
    if (!window.confirm("Delete this equipment record?")) return;
    try {
      await apiCall(`/equipment-records/${equipmentId}`, { method: "DELETE" });
      await fetchAllEquipments();
    } catch (err) {
      // error already set
    }
  }

  function calculateDueDate(baseDate, intervalWeeks) {
    if (!baseDate || !intervalWeeks) return "";
    const date = new Date(baseDate);
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + (parseInt(intervalWeeks) * 7));
    return newDate.toISOString().split('T')[0];
  }

  function handleDoneClick(equipment) {
    setDoneEquipment(equipment);
    const initialInterval = equipment.interval_weeks?.toString() || "";
    setDoneInterval(initialInterval);
    
    // Calculate new due date: current due date + interval weeks
    if (equipment.due_date && equipment.interval_weeks) {
      setCalculatedDueDate(calculateDueDate(equipment.due_date, equipment.interval_weeks));
    } else if (equipment.anchor_date && equipment.interval_weeks) {
      // If no due date, use anchor date + interval weeks
      setCalculatedDueDate(calculateDueDate(equipment.anchor_date, equipment.interval_weeks));
    } else {
      setCalculatedDueDate("");
    }
    setShowDoneModal(true);
  }

  function handleIntervalChange(newInterval) {
    setDoneInterval(newInterval);
    // Recalculate due date when interval changes
    if (doneEquipment) {
      const baseDate = doneEquipment.due_date || doneEquipment.anchor_date;
      if (baseDate && newInterval) {
        setCalculatedDueDate(calculateDueDate(baseDate, newInterval));
      }
    }
  }

  async function handleSaveDone() {
    if (!doneEquipment || !calculatedDueDate) {
      setError("Due date is required");
      return;
    }
    try {
      const updatePayload = {
        due_date: calculatedDueDate
      };
      // Update interval if it changed
      if (doneInterval && parseInt(doneInterval) !== doneEquipment.interval_weeks) {
        updatePayload.interval_weeks = parseInt(doneInterval);
      }
      await apiCall(`/equipment-records/${doneEquipment.id}`, {
        method: "PUT",
        body: JSON.stringify(updatePayload)
      });
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

  // Count active filters
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
          {loading ? (
            <p>Loading...</p>
          ) : allEquipments.length === 0 ? (
            <p className="empty">No equipments found</p>
          ) : filteredAndSortedEquipments.length === 0 ? (
            <p className="empty">No equipments match your filters.</p>
          ) : (
            <ul className="list">
              {filteredAndSortedEquipments.map(equipment => {
                return (
                  <li 
                    key={equipment.id} 
                    ref={el => equipmentRefs.current[equipment.id] = el}
                    className="list-item"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSelectedEquipment(equipment);
                      setShowDetailsModal(true);
                    }}
                  >
                    <div className="list-main">
                      <div className="list-title">
                        {equipment.equipment_name || `Equipment ID: ${equipment.id}`}
                      </div>
                      <div className="list-subtitle">
                        {equipment.equipment_type_name && `Type: ${equipment.equipment_type_name} • `}
                        Anchor: {formatDate(equipment.anchor_date)}
                        {equipment.due_date && ` • Due: ${formatDate(equipment.due_date)}`}
                        {equipment.client_name && ` • Client: ${equipment.client_name}`}
                        {equipment.interval_weeks && ` • Interval: ${equipment.interval_weeks} weeks`}
                      </div>
                    </div>
                    <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleDoneClick(equipment)}>Done</button>
                      <button onClick={() => {
                        if (onNavigateToAddEquipment) {
                          onNavigateToAddEquipment(equipment);
                        }
                      }}>Edit</button>
                      <button className="danger" onClick={() => handleDeleteEquipment(equipment.id)}>Delete</button>
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
              {/* Equipment Information */}
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Equipment Information</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.9rem" }}>
                  <div><strong>Equipment Name:</strong> {selectedEquipment.equipment_name || "N/A"}</div>
                  <div><strong>Equipment Type:</strong> {selectedEquipment.equipment_type_name || "N/A"}</div>
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

              {/* Client Information */}
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Client Information</h3>
                <div style={{ fontSize: "0.9rem" }}>
                  <div><strong>Name:</strong> {selectedEquipment.client_name || "N/A"}</div>
                </div>
              </div>

              {/* Site Information */}
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Site Information</h3>
                <div style={{ fontSize: "0.9rem" }}>
                  <div><strong>Name:</strong> {selectedEquipment.site_name || "N/A"}</div>
                </div>
              </div>

              {/* Actions */}
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
                  type="date"
                  value={calculatedDueDate}
                  onChange={(e) => setCalculatedDueDate(e.target.value)}
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
                  {(doneEquipment.due_date || doneEquipment.anchor_date) ? 
                    `${formatDate(doneEquipment.due_date || doneEquipment.anchor_date)} + ${doneInterval || 0} weeks` :
                    "Set base date first"
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

// Upcoming View
function UpcomingView({ apiCall, setError, upcoming, setUpcoming, loading, setLoading, upcomingStartDate, setUpcomingStartDate, upcomingEndDate, setUpcomingEndDate, onNavigateToSchedule }) {
  async function fetchUpcoming() {
    setLoading(true);
    setError("");
    try {
      let url = "/equipment-records/upcoming";
      
      if (upcomingStartDate) {
        let endDate = upcomingEndDate;
        // If start date is set but no end date, use start date + 14 days
        if (!endDate) {
          const startDate = new Date(upcomingStartDate);
          startDate.setDate(startDate.getDate() + 14); // Add 14 days
          endDate = startDate.toISOString().split('T')[0];
        }
        url += `?start_date=${upcomingStartDate}&end_date=${endDate}`;
      } else {
        // Default to 2 weeks from today
        url += "?weeks=2";
      }
      
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
        {items.map(item => (
          <li 
            key={item.id} 
            className={`list-item ${className}`}
            style={{ cursor: "pointer" }}
            onClick={() => {
              if (onNavigateToSchedule && item.id) {
                onNavigateToSchedule(item.id, null);
              }
            }}
          >
            <div className="list-main">
              <div className="list-title">{item.equipment_name || 'Unknown'}</div>
              <div className="list-subtitle">
                {item.equipment_type_name && `Type: ${item.equipment_type_name} • `}
                Client: {item.client_name}
                {item.site_name && ` • Site: ${item.site_name}`}
                {` • Due: ${formatDate(item.due_date)}`}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  useEffect(() => {
    fetchUpcoming();
  }, [upcomingStartDate, upcomingEndDate]);

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
              Start Date
              <input
                type="date"
                value={upcomingStartDate}
                onChange={(e) => {
                  const selectedDate = e.target.value;
                  const today = new Date().toISOString().split('T')[0];
                  if (selectedDate >= today) {
                    setUpcomingStartDate(selectedDate);
                    // If end date is set and is before the new start date, clear it
                    if (upcomingEndDate && selectedDate > upcomingEndDate) {
                      setUpcomingEndDate("");
                    }
                  } else if (selectedDate === "") {
                    // Allow clearing the date
                    setUpcomingStartDate("");
                  }
                }}
                min={new Date().toISOString().split('T')[0]}
                style={{ padding: "0.5rem" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              End Date (Optional)
              <input
                type="date"
                value={upcomingEndDate}
                onChange={(e) => {
                  const selectedDate = e.target.value;
                  const today = new Date().toISOString().split('T')[0];
                  const minDate = upcomingStartDate || today;
                  if (selectedDate >= minDate) {
                    setUpcomingEndDate(selectedDate);
                  } else if (selectedDate === "") {
                    // Allow clearing the date
                    setUpcomingEndDate("");
                  }
                }}
                min={upcomingStartDate || new Date().toISOString().split('T')[0]}
                style={{ padding: "0.5rem" }}
              />
            </label>
            {(upcomingStartDate || upcomingEndDate) && (
              <button
                className="secondary"
                onClick={() => {
                  setUpcomingStartDate("");
                  setUpcomingEndDate("");
                }}
                style={{ marginTop: "1.5rem" }}
              >
                Clear Dates
              </button>
            )}
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

// Overdue View
function OverdueView({ apiCall, setError, overdue, setOverdue, loading, setLoading, onNavigateToSchedule }) {
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
        {items.map(item => (
          <li 
            key={item.id} 
            className={`list-item ${className}`}
            style={{ cursor: "pointer" }}
            onClick={() => {
              if (onNavigateToSchedule && item.id) {
                onNavigateToSchedule(item.id, null);
              }
            }}
          >
            <div className="list-main">
              <div className="list-title">{item.equipment_name || 'Unknown'}</div>
              <div className="list-subtitle">
                {item.equipment_type_name && `Type: ${item.equipment_type_name} • `}
                Client: {item.client_name}
                {item.site_name && ` • Site: ${item.site_name}`}
                {` • Due: ${formatDate(item.due_date)}`}
              </div>
            </div>
          </li>
        ))}
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

// Deprecated QuickViewsTab removed - functionality moved to separate views (AllEquipmentsView, UpcomingView, OverdueView)

// Add Equipment Page
function AddEquipmentPage({ apiCall, setError, clients, sites, equipmentToEdit, previousView, onBack, onSuccess }) {
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [availableSites, setAvailableSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showNewTypeForm, setShowNewTypeForm] = useState(false);
  const [newTypeForm, setNewTypeForm] = useState({
    name: "",
    interval_weeks: "52",
    rrule: "FREQ=WEEKLY;INTERVAL=52",
    default_lead_weeks: "4",
    active: true,
  });
  const [equipmentForm, setEquipmentForm] = useState({
    equipment_type_id: "",
    equipment_name: "",
    anchor_date: "",
    due_date: "",
    interval_weeks: "",
    lead_weeks: "",
    timezone: "",
    notes: "",
    active: true,
  });

  useEffect(() => {
    async function loadData() {
      // Fetch equipment types
      try {
        const types = await apiCall("/equipment-types?active_only=true");
        setEquipmentTypes(types || []);
      } catch (err) {
        setEquipmentTypes([]);
      }

      if (equipmentToEdit && equipmentToEdit.id) {
        // Load existing equipment record
        try {
          const record = await apiCall(`/equipment-records/${equipmentToEdit.id}`);
          setSelectedClientId(record.client_id.toString());
          setSelectedSiteId(record.site_id.toString());
          await fetchSitesForClient(record.client_id);
          setEquipmentForm({
            equipment_type_id: record.equipment_type_id?.toString() || "",
            equipment_name: record.equipment_name || "",
            anchor_date: record.anchor_date || "",
            due_date: record.due_date || "",
            interval_weeks: record.interval_weeks?.toString() || "",
            lead_weeks: record.lead_weeks?.toString() || "",
            timezone: record.timezone || "",
            notes: record.notes || "",
            active: record.active !== undefined ? record.active : true,
          });
        } catch (err) {
          console.error("Failed to load equipment record:", err);
        }
      } else if (equipmentToEdit && equipmentToEdit.client) {
        // Pre-select client if provided
        setSelectedClientId(equipmentToEdit.client.id.toString());
        if (equipmentToEdit.site) {
          setSelectedSiteId(equipmentToEdit.site.id.toString());
        }
        await fetchSitesForClient(equipmentToEdit.client.id);
      }
    }
    loadData();
  }, [equipmentToEdit, apiCall]);

  // Fetch sites when client changes
  useEffect(() => {
    if (selectedClientId) {
      fetchSitesForClient(selectedClientId);
    } else {
      setAvailableSites([]);
      setSelectedSiteId("");
    }
  }, [selectedClientId]);

  async function fetchSitesForClient(clientId) {
    try {
      const data = await apiCall(`/sites?client_id=${clientId}`);
      setAvailableSites(data || []);
    } catch (err) {
      setAvailableSites([]);
    }
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setEquipmentForm(prev => {
      const updated = { ...prev, [name]: type === "checkbox" ? checked : value };
      // Auto-populate interval_weeks when equipment type is selected
      if (name === "equipment_type_id" && value) {
        const selectedType = equipmentTypes.find(t => t.id === parseInt(value));
        if (selectedType && selectedType.interval_weeks) {
          updated.interval_weeks = selectedType.interval_weeks.toString();
        }
      }
      return updated;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (!selectedClientId || !selectedSiteId) {
        setError("Client and Site are required");
        return;
      }
      if (!equipmentForm.equipment_type_id || !equipmentForm.equipment_name || !equipmentForm.anchor_date) {
        setError("Equipment Type, Equipment Name, and Anchor Date are required");
        return;
      }

      const payload = {
        client_id: parseInt(selectedClientId),
        site_id: parseInt(selectedSiteId),
        equipment_type_id: parseInt(equipmentForm.equipment_type_id),
        equipment_name: equipmentForm.equipment_name,
        anchor_date: equipmentForm.anchor_date,
        due_date: equipmentForm.due_date || null,
        interval_weeks: equipmentForm.interval_weeks ? parseInt(equipmentForm.interval_weeks) : 52,
        lead_weeks: equipmentForm.lead_weeks ? parseInt(equipmentForm.lead_weeks) : null,
        timezone: equipmentForm.timezone || null,
        notes: equipmentForm.notes || null,
        active: equipmentForm.active,
      };

      if (equipmentToEdit && equipmentToEdit.id) {
        // Update existing equipment record
        await apiCall(`/equipment-records/${equipmentToEdit.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        // Create new equipment record
        await apiCall("/equipment-records", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      // error already set
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>{equipmentToEdit && equipmentToEdit.id ? "Edit Equipment" : "Add New Equipment"}</h2>
        <button onClick={onBack}>Back</button>
      </div>

      <form onSubmit={handleSubmit} style={{ padding: "1rem" }}>
        <label>
          Client *
          <select
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setSelectedSiteId("");
            }}
            required
          >
            <option value="">Select a client</option>
            {clients.map(client => (
              <option key={client.id} value={client.id.toString()}>
                {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Site *
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            required
            disabled={!selectedClientId}
          >
            <option value="">{selectedClientId ? "Select a site" : "Select client first"}</option>
            {availableSites.map(site => (
              <option key={site.id} value={site.id.toString()}>
                {site.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Equipment Type *
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <select
              name="equipment_type_id"
              value={equipmentForm.equipment_type_id}
              onChange={handleChange}
              required
              style={{ flex: 1 }}
            >
              <option value="">Select an equipment type</option>
              {equipmentTypes.map(type => (
                <option key={type.id} value={type.id.toString()}>
                  {type.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowNewTypeForm(true)}
              style={{ whiteSpace: "nowrap" }}
            >
              + Add New Type
            </button>
          </div>
        </label>

        {showNewTypeForm && (
          <div style={{ 
            padding: "1rem", 
            backgroundColor: "#8193A4", 
            borderRadius: "0.5rem", 
            marginTop: "0.5rem",
            border: "1px solid #2D3234"
          }}>
            <h4 style={{ marginTop: 0, marginBottom: "1rem", color: "#2D3234" }}>Add New Equipment Type</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ color: "#2D3234" }}>
                Name *
                <input
                  type="text"
                  value={newTypeForm.name}
                  onChange={(e) => setNewTypeForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                  placeholder="Equipment type name"
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                />
              </label>
              <label style={{ color: "#2D3234" }}>
                Interval (weeks) *
                <input
                  type="number"
                  value={newTypeForm.interval_weeks}
                  onChange={(e) => {
                    const interval = e.target.value;
                    setNewTypeForm(prev => ({ 
                      ...prev, 
                      interval_weeks: interval,
                      rrule: `FREQ=WEEKLY;INTERVAL=${interval || 52}`
                    }));
                  }}
                  required
                  min="1"
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                />
              </label>
              <label style={{ color: "#2D3234" }}>
                Default Lead Weeks *
                <input
                  type="number"
                  value={newTypeForm.default_lead_weeks}
                  onChange={(e) => setNewTypeForm(prev => ({ ...prev, default_lead_weeks: e.target.value }))}
                  required
                  min="0"
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                />
              </label>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    if (!newTypeForm.name.trim()) {
                      setError("Equipment type name is required");
                      return;
                    }
                    try {
                      const newType = await apiCall("/equipment-types", {
                        method: "POST",
                        body: JSON.stringify({
                          name: newTypeForm.name,
                          interval_weeks: parseInt(newTypeForm.interval_weeks) || 52,
                          rrule: newTypeForm.rrule || `FREQ=WEEKLY;INTERVAL=${parseInt(newTypeForm.interval_weeks) || 52}`,
                          default_lead_weeks: parseInt(newTypeForm.default_lead_weeks) || 4,
                          active: newTypeForm.active,
                        }),
                      });
                      // Refresh equipment types list
                      const types = await apiCall("/equipment-types?active_only=true");
                      setEquipmentTypes(types || []);
                      // Select the newly created type
                      setEquipmentForm(prev => ({
                        ...prev,
                        equipment_type_id: newType.id.toString(),
                        interval_weeks: newType.interval_weeks.toString(),
                      }));
                      // Reset and hide form
                      setNewTypeForm({
                        name: "",
                        interval_weeks: "52",
                        rrule: "FREQ=WEEKLY;INTERVAL=52",
                        default_lead_weeks: "4",
                        active: true,
                      });
                      setShowNewTypeForm(false);
                    } catch (err) {
                      // error already set
                    }
                  }}
                >
                  Create
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setShowNewTypeForm(false);
                    setNewTypeForm({
                      name: "",
                      interval_weeks: "52",
                      rrule: "FREQ=WEEKLY;INTERVAL=52",
                      default_lead_weeks: "4",
                      active: true,
                    });
                  }}
                  style={{ 
                    color: "#2D3234", 
                    border: "1px solid #2D3234",
                    background: "transparent"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <label>
          Equipment Name *
          <input
            type="text"
            name="equipment_name"
            value={equipmentForm.equipment_name}
            onChange={handleChange}
            required
            placeholder="e.g., Scanner Model XYZ, Room 101"
          />
        </label>

        <label>
          Anchor Date *
          <input
            type="date"
            name="anchor_date"
            value={equipmentForm.anchor_date}
            onChange={handleChange}
            required
          />
        </label>

        <label>
          Due Date
          <input
            type="date"
            name="due_date"
            value={equipmentForm.due_date}
            onChange={handleChange}
          />
        </label>

        <label>
          Interval (weeks) *
          <input
            type="number"
            name="interval_weeks"
            value={equipmentForm.interval_weeks}
            onChange={handleChange}
            min="1"
            required
            placeholder="e.g., 52"
          />
        </label>

        <label>
          Lead Weeks
          <input
            type="number"
            name="lead_weeks"
            value={equipmentForm.lead_weeks}
            onChange={handleChange}
            min="0"
          />
        </label>

        <label>
          Timezone
          <input
            type="text"
            name="timezone"
            value={equipmentForm.timezone}
            onChange={handleChange}
            placeholder="e.g., America/New_York"
          />
        </label>

        <label>
          Notes
          <textarea
            name="notes"
            value={equipmentForm.notes}
            onChange={handleChange}
            rows="3"
          />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            name="active"
            checked={equipmentForm.active}
            onChange={handleChange}
          />
          Active
        </label>

        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Saving..." : (equipmentToEdit && equipmentToEdit.id ? "Update" : "Create")}
          </button>
          <button type="button" onClick={onBack}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

// Deprecated QuickViewsTab removed - functionality moved to separate views (AllEquipmentsView, UpcomingView, OverdueView)

// Admin Tab
function AdminTab({ apiCall, setError }) {
  const [adminTab, setAdminTab] = useState("utilities"); // "utilities" or "equipments"
  const [uploading, setUploading] = useState(false);
  const [uploadingTemporary, setUploadingTemporary] = useState(false);
  const fileInputRef = useRef(null);
  const temporaryFileInputRef = useRef(null);

  async function handleImportEquipments(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError("File must be an Excel file (.xlsx or .xls)");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/admin/import/equipments`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const stats = result.stats || {};
      
      let message = `Import completed successfully.\n\n`;
      message += `Created: ${stats.equipment_types_created || 0} equipment type(s), ${stats.equipment_records_created || 0} equipment record(s).\n`;
      if (stats.rows_skipped > 0) {
        message += `Skipped: ${stats.rows_skipped} row(s) due to missing or invalid data.\n`;
      }
      if (stats.duplicates_skipped > 0) {
        message += `${stats.duplicates_skipped} record(s) already exist and were skipped.\n`;
      }
      
      if (stats.errors && stats.errors.length > 0) {
        const errorDetails = stats.errors.slice(0, 20).join('\n');
        const errorMsg = `${message}\n\nErrors (${stats.errors.length}):\n${errorDetails}${stats.errors.length > 20 ? '\n... and more' : ''}`;
        setError(errorMsg);
        alert(errorMsg);
      } else {
        alert(message);
      }
    } catch (err) {
      setError(err.message || "Failed to import equipment file");
      alert(err.message || "Failed to import equipment file");
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleTemporaryDataUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError("File must be an Excel file (.xlsx or .xls)");
      return;
    }

    setUploadingTemporary(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/admin/import/temporary`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const stats = result.stats || {};
      
      let message = `Import completed successfully.\n\n`;
      message += `Created: ${stats.clients_created || 0} client(s), ${stats.sites_created || 0} site(s), ${stats.equipment_types_created || 0} equipment type(s), ${stats.equipment_records_created || 0} equipment record(s).\n`;
      if (stats.rows_skipped > 0) {
        message += `Skipped: ${stats.rows_skipped} row(s) due to missing or invalid data.\n`;
      }
      if (stats.duplicates_skipped > 0) {
        message += `${stats.duplicates_skipped} record(s) already exist and were skipped.\n`;
      }
      
      if (stats.errors && stats.errors.length > 0) {
        const errorDetails = stats.errors.slice(0, 20).join('\n');
        const errorMsg = `${message}\n\nErrors (${stats.errors.length}):\n${errorDetails}${stats.errors.length > 20 ? '\n... and more' : ''}`;
        setError(errorMsg);
        alert(errorMsg);
      } else {
        alert(message);
      }
    } catch (err) {
      setError(err.message || "Failed to import temporary data file");
      alert(err.message || "Failed to import temporary data file");
    } finally {
      setUploadingTemporary(false);
      e.target.value = '';
    }
  }

  async function handleExportEquipments() {
    try {
      const response = await fetch(`${API_BASE}/admin/export/equipments`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'equipments_export.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err.message || "Failed to export equipments");
    }
  }

  return (
    <div className="admin-tab">
      <nav className="tabs" style={{ marginBottom: "1rem" }}>
        <button
          className={adminTab === "utilities" ? "active" : ""}
          onClick={() => setAdminTab("utilities")}
        >
          Utilities
        </button>
        <button
          className={adminTab === "equipments" ? "active" : ""}
          onClick={() => setAdminTab("equipments")}
        >
          Equipments
        </button>
      </nav>

      {adminTab === "utilities" && (
        <div className="card">
          <div className="card-header">
            <h2>Utilities</h2>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {/* Import Equipments */}
            <div>
              <h3>Import Equipments</h3>
              <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1rem" }}>
                Import equipment records from Excel file. Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date.
                <br />
                <strong>Note:</strong> If client or site doesn't exist, the row will be skipped. If equipment identifier doesn't exist, a new equipment will be created.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImportEquipments}
                  disabled={uploading || uploadingTemporary}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={uploading || uploadingTemporary}
                  style={{ cursor: (uploading || uploadingTemporary) ? "not-allowed" : "pointer" }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? "Uploading..." : "📁 Import Equipments"}
                </button>
              </div>
            </div>

            {/* Temporary Data Upload */}
            <div>
              <h3>Temporary Data Upload</h3>
              <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1rem" }}>
                Import equipment records from Excel file. Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date.
                <br />
                <strong>Note:</strong> If client or site doesn't exist, they will be created automatically. If equipment identifier doesn't exist, a new equipment will be created.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  ref={temporaryFileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleTemporaryDataUpload}
                  disabled={uploading || uploadingTemporary}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={uploading || uploadingTemporary}
                  style={{ cursor: (uploading || uploadingTemporary) ? "not-allowed" : "pointer" }}
                  onClick={() => temporaryFileInputRef.current?.click()}
                >
                  {uploadingTemporary ? "Uploading..." : "📁 Temporary Data Upload"}
                </button>
              </div>
            </div>

            {/* Export Equipments */}
            <div>
              <h3>Export Equipments</h3>
              <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1rem" }}>
                Export all equipment records to Excel file.
              </p>
              <button
                type="button"
                className="primary"
                onClick={handleExportEquipments}
              >
                📥 Export Equipments
              </button>
            </div>
          </div>
        </div>
      )}

      {adminTab === "equipments" && (
        <div className="card">
          <div className="card-header">
            <h2>Equipments</h2>
          </div>
          <div style={{ padding: "2rem" }}>
            <p className="empty">This section is coming soon.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Reports Tab - REMOVED

export default App;
