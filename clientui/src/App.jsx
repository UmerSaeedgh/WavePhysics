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
  const [view, setView] = useState("clients"); // "clients", "client-sites", "site-details", "quick-views", "reports", "admin", "add-equipment"
  const [equipmentToEdit, setEquipmentToEdit] = useState(null); // Schedule to edit when navigating to add-equipment page
  const [previousView, setPreviousView] = useState(null); // Track previous view to return to after add-equipment
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedSite, setSelectedSite] = useState(null);
  const [scrollToScheduleId, setScrollToScheduleId] = useState(null);
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [contactLinks, setContactLinks] = useState([]);
  const [testTypes, setTestTypes] = useState([]);
  const [clientEquipments, setClientEquipments] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchClients();
    fetchTestTypes();
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
      // Clear old schedules when switching sites to prevent showing old data
      setSchedules([]);
      fetchSchedules(selectedSite.id);
      fetchSiteContacts(selectedSite.id);
    }
  }, [selectedSite]);

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

  async function fetchTestTypes() {
    setLoading(true);
    try {
      const data = await apiCall("/test-types");
      setTestTypes(data);
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

  async function fetchSchedules(siteId = null) {
    setLoading(true);
    try {
      const endpoint = siteId ? `/schedules?site_id=${siteId}` : "/schedules";
      const data = await apiCall(endpoint);
      console.log(`Fetched ${data?.length || 0} schedules for site ${siteId}`);
      setSchedules(data || []);
    } catch (err) {
      console.error("Error fetching schedules:", err);
      // error already set
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchWorkOrders(scheduleId = null, status = null) {
    setLoading(true);
    try {
      const params = [];
      // Ensure scheduleId is a valid number or null
      const validScheduleId = scheduleId && (typeof scheduleId === 'number' ? scheduleId : 
                           (!isNaN(parseInt(scheduleId)) ? parseInt(scheduleId) : null));
      if (validScheduleId) params.push(`schedule_id=${validScheduleId}`);
      if (status) params.push(`status=${status}`);
      const endpoint = params.length ? `/work-orders?${params.join("&")}` : "/work-orders";
      const data = await apiCall(endpoint);
      setWorkOrders(data);
    } catch (err) {
      // error already set
    } finally {
      setLoading(false);
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
            Clients
          </button>
          <button
            className={view === "quick-views" ? "active" : ""}
            onClick={() => setView("quick-views")}
          >
            Quick Views
          </button>
          <button
            className={view === "reports" ? "active" : ""}
            onClick={() => setView("reports")}
          >
            Reports
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
              setSelectedClient(client);
              setView("client-sites");
            }}
            apiCall={apiCall}
            setError={setError}
          />
        )}

        {view === "client-sites" && selectedClient && (
          <ClientSitesView
            client={selectedClient}
            sites={sites}
            clientEquipments={clientEquipments}
            onRefreshSites={() => fetchSites(selectedClient.id)}
            onRefreshEquipments={() => fetchClientEquipments(selectedClient.id)}
            onSiteClick={(site) => {
              setSelectedSite(site);
              setView("site-details");
            }}
            onBack={() => {
              setView("clients");
              setSelectedClient(null);
            }}
            apiCall={apiCall}
            setError={setError}
          />
        )}

        {view === "site-details" && selectedSite && selectedClient && (
          <SiteDetailsView
            client={selectedClient}
            site={selectedSite}
            clientEquipments={clientEquipments}
            schedules={schedules}
            contactLinks={contactLinks}
            scrollToScheduleId={scrollToScheduleId}
            onScrollComplete={() => setScrollToScheduleId(null)}
            onRefreshSchedules={() => fetchSchedules(selectedSite.id)}
            onRefreshEquipments={() => fetchClientEquipments(selectedClient.id)}
            onRefreshContacts={() => fetchSiteContacts(selectedSite.id)}
            onBack={() => {
              setView("client-sites");
              setSelectedSite(null);
              setScrollToScheduleId(null);
            }}
            onNavigateToAddEquipment={(schedule) => {
              setEquipmentToEdit(schedule);
              setPreviousView("site-details");
              setView("add-equipment");
            }}
            apiCall={apiCall}
            setError={setError}
          />
        )}

        {view === "quick-views" && (
          <QuickViewsTab 
            apiCall={apiCall} 
            setError={setError}
            clients={clients}
            sites={sites}
            onNavigateToSchedule={async (scheduleId, siteId) => {
              try {
                // Clear old schedules first to prevent showing old data
                setSchedules([]);
                // Fetch the site directly from API
                const siteData = await apiCall(`/sites/${siteId}`);
                if (siteData && siteData.client_id) {
                  // Fetch the client directly from API
                  const clientData = await apiCall(`/clients/${siteData.client_id}`);
                  if (clientData) {
                    setSelectedClient(clientData);
                    setSelectedSite(siteData);
                    // Store schedule ID to scroll to BEFORE changing view
                    setScrollToScheduleId(scheduleId);
                    setView("site-details");
                    // Fetch schedules for the new site (this will trigger the scroll effect)
                    await fetchSchedules(siteId);
                  }
                }
              } catch (err) {
                setError("Failed to navigate to schedule: " + (err.message || "Unknown error"));
              }
            }}
            onNavigateToAddEquipment={(schedule) => {
              setEquipmentToEdit(schedule);
              setPreviousView("quick-views");
              setView("add-equipment");
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
              const returnView = previousView || "quick-views";
              setEquipmentToEdit(null);
              setPreviousView(null);
              setView(returnView);
            }}
            onSuccess={async () => {
              const returnView = previousView || "quick-views";
              setEquipmentToEdit(null);
              setPreviousView(null);
              setView(returnView);
              // Refresh data if coming from site-details
              if (returnView === "site-details" && selectedSite) {
                await fetchSchedules(selectedSite.id);
              }
            }}
          />
        )}

        {view === "reports" && (
          <ReportsTab apiCall={apiCall} setError={setError} />
        )}

        {view === "admin" && (
          <AdminTab apiCall={apiCall} setError={setError} />
        )}

      </main>
    </div>
  );
}

// Clients List View - Main entry point
function ClientsListView({ clients, onRefresh, onClientClick, apiCall, setError }) {
  const [showForm, setShowForm] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [form, setForm] = useState({ name: "", address: "", billing_info: "", notes: "" });

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setSelectedClient(null);
    setShowForm(false);
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
      if (!isEdit && result && result.id) {
        try {
          await apiCall(`/clients/${result.id}/equipments/seed-defaults`, { method: "POST" });
        } catch (seedErr) {
          console.warn("Failed to seed default equipments:", seedErr);
        }
      }
      await onRefresh();
      resetForm();
    } catch (err) {
      setError(err.message || "Failed to save client");
    }
  }

  function startEdit(client) {
    setSelectedClient(client);
    setShowForm(true);
    setForm({ 
      name: client.name || "", 
      address: client.address || "", 
      billing_info: client.billing_info || "", 
      notes: client.notes || "" 
    });
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
    <div>
      <div className="card">
        <div className="card-header">
          <h2>Clients ({clients.length})</h2>
          <button className="primary" onClick={() => { resetForm(); setShowForm(true); }}>+ Add New Client</button>
        </div>
        
        {showForm && (
          <div style={{ padding: "1rem", borderBottom: "1px solid #8193A4" }}>
            <form onSubmit={handleSubmit} className="form">
              <label>
                Name *
                <input type="text" name="name" value={form.name} onChange={handleChange} required />
              </label>
              <label>
                Address
                <input type="text" name="address" value={form.address} onChange={handleChange} placeholder="Client address" />
              </label>
              <label>
                Billing Info
                <textarea name="billing_info" value={form.billing_info} onChange={handleChange} rows={2} placeholder="Billing address, payment terms, etc." />
              </label>
              <label>
                Notes
                <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} />
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button type="submit" className="primary" style={{ marginTop: 0 }}>{selectedClient ? "Save" : "Create"}</button>
                <button type="button" className="secondary" onClick={resetForm}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {clients.length === 0 ? (
          <p className="empty">No clients yet. Click "Add New Client" to get started.</p>
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
                  <button onClick={() => onClientClick(client)}>Update</button>
                  <button onClick={() => startEdit(client)}>Edit</button>
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

// Client Sites View - Shows sites for a selected client
function ClientSitesView({ client, sites, clientEquipments, onRefreshSites, onRefreshEquipments, onSiteClick, onBack, apiCall, setError }) {
  const [showForm, setShowForm] = useState(false);
  const [selectedSite, setSelectedSite] = useState(null);
  const [form, setForm] = useState({
    name: "",
    address: "",
    timezone: "America/Chicago",
    notes: "",
  });

  useEffect(() => {
    onRefreshSites();
    onRefreshEquipments();
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setSelectedSite(null);
    setShowForm(false);
    setForm({
      name: "",
      address: "",
      timezone: "America/Chicago",
      notes: "",
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    try {
      const isEdit = !!selectedSite;
      const endpoint = isEdit ? `/sites/${selectedSite.id}` : "/sites";
      const payload = { ...form, client_id: client.id };
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
    setShowForm(true);
    setForm({
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

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>← Back to Clients</button>
        <h2 style={{ margin: 0 }}>{client.name} - Sites</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Sites ({sites.length})</h2>
          <button className="primary" onClick={() => { resetForm(); setShowForm(true); }}>+ Add New Site</button>
        </div>

        {showForm && (
          <div style={{ padding: "1rem", borderBottom: "1px solid #8193A4" }}>
            <form onSubmit={handleSubmit} className="form">
              <label>
                Name *
                <input type="text" name="name" value={form.name} onChange={handleChange} required />
              </label>
              <label>
                Address
                <input type="text" name="address" value={form.address} onChange={handleChange} />
              </label>
              <label>
                Timezone
                <input type="text" name="timezone" value={form.timezone} onChange={handleChange} placeholder="America/Chicago" />
              </label>
              <label>
                Notes
                <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} />
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button type="submit" className="primary" style={{ marginTop: 0 }}>{selectedSite ? "Save" : "Create"}</button>
                <button type="button" className="secondary" onClick={resetForm}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {sites.length === 0 ? (
          <p className="empty">No sites yet. Click "Add New Site" to get started.</p>
        ) : (
          <ul className="list">
            {sites.map(site => (
              <li key={site.id} className="list-item" style={{ cursor: "pointer" }}>
                <div className="list-main" onClick={() => onSiteClick(site)}>
                  <div className="list-title">{site.name}</div>
                  <div className="list-subtitle">
                    {site.address && `${site.address} • `}
                    {site.timezone}
                  </div>
                </div>
                <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => startEdit(site)}>Edit</button>
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

// Site Details View - Shows equipments, schedules, and contacts for a site
function SiteDetailsView({ client, site, clientEquipments, schedules, contactLinks, scrollToScheduleId, onScrollComplete, onRefreshSchedules, onRefreshEquipments, onRefreshContacts, onBack, onNavigateToAddEquipment, apiCall, setError }) {
  const scheduleRefs = useRef({});
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    equipment_id: "",
    anchor_date: "",
    due_date: "",
    lead_weeks: "",
    timezone: "",
    equipment_identifier: "",
    notes: "",
    rrule: "",
  });
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [equipmentForm, setEquipmentForm] = useState({
    name: "",
    interval_weeks: "52",
    rrule: "FREQ=WEEKLY;INTERVAL=52",
    default_lead_weeks: "4",
  });
  const [showEquipmentForm, setShowEquipmentForm] = useState(false);
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [completedSchedules, setCompletedSchedules] = useState([]);
  const [showScheduleDetailsModal, setShowScheduleDetailsModal] = useState(false);
  const [selectedScheduleDetails, setSelectedScheduleDetails] = useState(null);

  useEffect(() => {
    onRefreshSchedules();
    onRefreshEquipments();
    onRefreshContacts();
  }, []);

  // Scroll to specific schedule when scrollToScheduleId is set and schedules are loaded
  useEffect(() => {
    if (scrollToScheduleId && schedules.length > 0) {
      // Verify the schedule exists in the current site's schedules
      const scheduleExists = schedules.some(s => s.id === scrollToScheduleId);
      if (!scheduleExists) {
        // Schedule not found in current schedules, clear scroll target
        if (onScrollComplete) onScrollComplete();
        return;
      }
      
      // Wait for DOM to update, then scroll
      // Use a longer timeout to ensure the list is fully rendered
      setTimeout(() => {
        const scheduleElement = scheduleRefs.current[scrollToScheduleId];
        if (scheduleElement) {
          scheduleElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Highlight the schedule briefly
          scheduleElement.style.backgroundColor = '#8193A4';
          setTimeout(() => {
            scheduleElement.style.backgroundColor = '';
            if (onScrollComplete) onScrollComplete();
          }, 2000);
        } else {
          // Element not found yet, try again after a short delay
          setTimeout(() => {
            const retryElement = scheduleRefs.current[scrollToScheduleId];
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
  }, [scrollToScheduleId, schedules, onScrollComplete, site.id]);

  async function fetchCompletedSchedules() {
    try {
      const result = await apiCall(`/schedules/completed?site_id=${site.id}`);
      setCompletedSchedules(result);
    } catch (err) {
      // error already set
    }
  }

  async function handleCompleteSchedule(scheduleId) {
    try {
      console.log("Completing schedule:", scheduleId);
      const result = await apiCall(`/schedules/${scheduleId}/complete`, { method: "POST" });
      console.log("Complete result:", result);
      // Force refresh schedules to get updated list
      await onRefreshSchedules();
      // Also refresh completed schedules if modal is open
      if (showCompletedModal) {
        await fetchCompletedSchedules();
      }
    } catch (err) {
      console.error("Error completing schedule:", err);
      // error already set
    }
  }

  async function handleUndoSchedule(scheduleId) {
    try {
      await apiCall(`/schedules/${scheduleId}/undo`, { method: "POST" });
      await onRefreshSchedules();
      await fetchCompletedSchedules();
    } catch (err) {
      // error already set
    }
  }

  async function handleShowCompleted() {
    setShowCompletedModal(true);
    await fetchCompletedSchedules();
  }

  function handleScheduleChange(e) {
    const { name, value } = e.target;
    setScheduleForm(prev => ({ ...prev, [name]: value }));
  }

  function resetScheduleForm() {
    setSelectedSchedule(null);
    setShowScheduleForm(false);
    setScheduleForm({
      equipment_id: "",
      anchor_date: "",
      due_date: "",
      lead_weeks: "",
      timezone: "",
      equipment_identifier: "",
      notes: "",
      rrule: "",
    });
  }

  function resetEquipmentForm() {
    setSelectedEquipment(null);
    setShowEquipmentForm(false);
    setEquipmentForm({
      name: "",
      interval_weeks: "52",
      rrule: "FREQ=WEEKLY;INTERVAL=52",
      default_lead_weeks: "4",
    });
  }

  function startEditEquipment(equipment) {
    setSelectedEquipment(equipment);
    setShowEquipmentForm(true);
    setShowNewEquipmentForm(true);
    setEquipmentForm({
      name: equipment.name,
      interval_weeks: equipment.interval_weeks?.toString() || "52",
      rrule: equipment.rrule || "FREQ=WEEKLY;INTERVAL=52",
      default_lead_weeks: equipment.default_lead_weeks?.toString() || "4",
    });
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
      const endpoint = isEdit ? `/equipments/${selectedEquipment.id}` : `/clients/${client.id}/equipments`;
      const payload = {
        name: equipmentForm.name,
        interval_weeks: parseInt(equipmentForm.interval_weeks) || 52,
        rrule: equipmentForm.rrule || `FREQ=WEEKLY;INTERVAL=${parseInt(equipmentForm.interval_weeks) || 52}`,
        default_lead_weeks: parseInt(equipmentForm.default_lead_weeks) || 4,
        active: true,
      };
      if (!isEdit) {
        payload.client_id = client.id;
      }
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onRefreshEquipments();
      resetEquipmentForm();
    } catch (err) {
      // error already set
    }
  }

  async function handleScheduleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!scheduleForm.equipment_id || !scheduleForm.anchor_date) {
      setError("Equipment and anchor date are required");
      return;
    }

    try {
      const isEdit = !!selectedSchedule;
      const endpoint = isEdit ? `/schedules/${selectedSchedule.id}` : "/schedules";
      const payload = {
        ...scheduleForm,
        site_id: site.id,
        equipment_id: parseInt(scheduleForm.equipment_id),
        lead_weeks: scheduleForm.lead_weeks ? parseInt(scheduleForm.lead_weeks) : null,
        timezone: scheduleForm.timezone || null,
      };
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onRefreshSchedules();
      resetScheduleForm();
    } catch (err) {
      // error already set
    }
  }

  function startEditSchedule(schedule) {
    setSelectedSchedule(schedule);
    // Ensure equipment_identifier is a string, not equipment_id
    // Check if equipment_identifier exists and is not a number (to avoid using equipment_id by mistake)
    let equipmentIdentifier = "";
    if (schedule.equipment_identifier !== undefined && schedule.equipment_identifier !== null) {
      // Only use it if it's not a number (equipment_id is a number, equipment_identifier should be a string)
      if (typeof schedule.equipment_identifier !== 'number') {
        equipmentIdentifier = String(schedule.equipment_identifier);
      }
    }
    setScheduleForm({
      equipment_id: schedule.equipment_id?.toString() || "",
      anchor_date: schedule.anchor_date || "",
      due_date: schedule.due_date || "",
      lead_weeks: schedule.lead_weeks?.toString() || "",
      timezone: schedule.timezone || "",
      equipment_identifier: equipmentIdentifier,
      notes: schedule.notes || "",
      rrule: schedule.rrule || "",
    });
    // Auto-populate RRule from equipment if available
    if (schedule.equipment_id) {
      const selectedEq = clientEquipments.find(e => e.id === schedule.equipment_id);
      if (selectedEq && selectedEq.rrule && !schedule.rrule) {
        setScheduleForm(prev => ({ ...prev, rrule: selectedEq.rrule }));
      }
    }
  }

  async function handleDeleteSchedule(scheduleId) {
    if (!window.confirm("Delete this schedule?")) return;
    try {
      await apiCall(`/schedules/${scheduleId}`, { method: "DELETE" });
      await onRefreshSchedules();
      if (selectedSchedule?.id === scheduleId) resetScheduleForm();
    } catch (err) {
      // error already set
    }
  }

  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showNewEquipmentForm, setShowNewEquipmentForm] = useState(false);
  const [newEquipmentForm, setNewEquipmentForm] = useState({
    name: "",
    interval_weeks: "52",
    rrule: "FREQ=WEEKLY;INTERVAL=52",
    default_lead_weeks: "4",
  });

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>← Back to Sites</button>
        <h2 style={{ margin: 0 }}>{site.name} - Details</h2>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-header">
          <h3>Schedules ({schedules.length})</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button 
              type="button" 
              className="secondary" 
              onClick={handleShowCompleted}
            >
              Show Completed Schedules
            </button>
            <button className="primary" onClick={() => {
              if (onNavigateToAddEquipment && client && site) {
                // Create a schedule-like object with client and site info for pre-selection
                onNavigateToAddEquipment({ 
                  client_id: client.id, 
                  site_id: site.id,
                  client: client,
                  site: site
                });
              } else {
                resetScheduleForm();
                setShowScheduleForm(true);
              }
            }} style={{ marginTop: 0 }}>+ Add New Equipment</button>
          </div>
        </div>

        {showScheduleForm && (
          <div style={{ padding: "1rem", borderBottom: "1px solid #8193A4" }}>
            <form onSubmit={handleScheduleSubmit} className="form">
              <label>
                Equipment Name
                <textarea 
                  name="equipment_identifier" 
                  value={scheduleForm.equipment_identifier || ""} 
                  onChange={handleScheduleChange} 
                  rows={2}
                  placeholder="e.g. Scanner Model XYZ, Room 101"
                />
              </label>
              <label>
                Equipment Type *
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <select name="equipment_id" value={scheduleForm.equipment_id} onChange={handleScheduleChange} required style={{ flex: 1 }}>
                    <option value="">Select equipment</option>
                    {clientEquipments.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                  <button type="button" className="secondary" onClick={() => { setShowNewEquipmentForm(true); setShowEquipmentForm(false); }}>+ Add New</button>
                  <button type="button" className="secondary" onClick={() => { setShowEquipmentForm(!showEquipmentForm); setShowNewEquipmentForm(false); }}>
                    {showEquipmentForm ? "Hide" : "Edit Equipments"}
                  </button>
                </div>
                {scheduleForm.equipment_id && (() => {
                  const selectedEq = clientEquipments.find(e => e.id === parseInt(scheduleForm.equipment_id));
                  return selectedEq && selectedEq.rrule ? (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#8193A4" }}>
                      Equipment RRule: {selectedEq.rrule}
                    </div>
                  ) : null;
                })()}
              </label>
              {showEquipmentForm && (
                <div style={{ padding: "1rem", backgroundColor: "#D7E5D8", borderRadius: "0.5rem", marginTop: "0.5rem", border: "1px solid #8193A4" }}>
                  <h4 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "0.95rem" }}>Manage Equipments</h4>
                  {clientEquipments.length === 0 ? (
                    <p style={{ color: "#8193A4", fontSize: "0.85rem" }}>No equipments available</p>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {clientEquipments.map(eq => (
                        <li key={eq.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem", backgroundColor: "#8193A4", borderRadius: "0.25rem" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: "600", color: "#2D3234", fontSize: "0.9rem" }}>
                              {eq.name} {eq.is_custom ? "(Custom)" : "(Default)"}
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "#2D3234", marginTop: "0.25rem" }}>
                              Every {eq.interval_weeks} weeks • Lead: {eq.default_lead_weeks} weeks
                              {eq.rrule && ` • RRule: ${eq.rrule}`}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <button 
                              type="button" 
                              onClick={() => {
                                startEditEquipment(eq);
                                setShowNewEquipmentForm(true);
                              }}
                              style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                            >
                              Edit
                            </button>
                            {eq.is_custom && (
                              <button 
                                type="button" 
                                className="danger"
                                onClick={async () => {
                                  if (window.confirm(`Delete equipment "${eq.name}"?`)) {
                                    try {
                                      await apiCall(`/equipments/${eq.id}`, { method: "DELETE" });
                                      await onRefreshEquipments();
                                      if (scheduleForm.equipment_id === eq.id.toString()) {
                                        setScheduleForm(prev => ({ ...prev, equipment_id: "" }));
                                      }
                                    } catch (err) {
                                      // error already set
                                    }
                                  }
                                }}
                                style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {(showNewEquipmentForm || selectedEquipment) && (
                <div style={{ padding: "1rem", backgroundColor: "#8193A4", borderRadius: "0.5rem", marginTop: "0.5rem", color: "#2D3234" }}>
                  <h4 style={{ marginTop: 0, marginBottom: "1rem", color: "#2D3234" }}>{selectedEquipment ? "Edit Equipment" : "Add New Equipment"}</h4>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    setError("");
                    const formData = selectedEquipment ? equipmentForm : newEquipmentForm;
                    if (!formData.name.trim()) {
                      setError("Equipment name is required");
                      return;
                    }
                    try {
                      const isEdit = !!selectedEquipment;
                      const endpoint = isEdit ? `/equipments/${selectedEquipment.id}` : `/clients/${client.id}/equipments`;
                      const payload = {
                        name: formData.name,
                        interval_weeks: parseInt(formData.interval_weeks) || 52,
                        rrule: formData.rrule || `FREQ=WEEKLY;INTERVAL=${parseInt(formData.interval_weeks) || 52}`,
                        default_lead_weeks: parseInt(formData.default_lead_weeks) || 4,
                        active: true,
                      };
                      if (!isEdit) {
                        payload.client_id = client.id;
                      }
                      const result = await apiCall(endpoint, {
                        method: isEdit ? "PUT" : "POST",
                        body: JSON.stringify(payload),
                      });
                      await onRefreshEquipments();
                      if (!isEdit) {
                        setScheduleForm(prev => ({ ...prev, equipment_id: result.id.toString(), rrule: result.rrule || "" }));
                      } else if (scheduleForm.equipment_id === selectedEquipment.id.toString()) {
                        setScheduleForm(prev => ({ ...prev, rrule: result.rrule || "" }));
                      }
                      setNewEquipmentForm({ name: "", interval_weeks: "52", rrule: "FREQ=WEEKLY;INTERVAL=52", default_lead_weeks: "4" });
                      resetEquipmentForm();
                      setShowNewEquipmentForm(false);
                    } catch (err) {
                      // error already set
                    }
                  }}>
                    <label>
                      Name *
                      <input
                        type="text"
                        value={newEquipmentForm.name}
                        onChange={(e) => setNewEquipmentForm(prev => ({ ...prev, name: e.target.value }))}
                        required
                        placeholder="Equipment name"
                      />
                    </label>
                    <label>
                      Interval (weeks)
                      <input
                        type="number"
                        value={newEquipmentForm.interval_weeks}
                        onChange={(e) => setNewEquipmentForm(prev => ({ ...prev, interval_weeks: e.target.value }))}
                        min="1"
                      />
                    </label>
                    <label>
                      Lead Weeks
                      <input
                        type="number"
                        value={newEquipmentForm.default_lead_weeks}
                        onChange={(e) => setNewEquipmentForm(prev => ({ ...prev, default_lead_weeks: e.target.value }))}
                        min="0"
                      />
                    </label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="submit" className="primary">{selectedEquipment ? "Save" : "Create"} Equipment</button>
                      <button type="button" className="secondary" onClick={() => {
                        setShowNewEquipmentForm(false);
                        setSelectedEquipment(null);
                        setNewEquipmentForm({ name: "", interval_weeks: "52", rrule: "FREQ=WEEKLY;INTERVAL=52", default_lead_weeks: "4" });
                      }}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}
              <label>
                Anchor Date *
                <input type="date" name="anchor_date" value={scheduleForm.anchor_date} onChange={handleScheduleChange} required />
              </label>
              <label>
                Due Date
                <input type="date" name="due_date" value={scheduleForm.due_date} onChange={handleScheduleChange} />
              </label>
              <label>
                Lead Weeks (override)
                <input type="number" name="lead_weeks" value={scheduleForm.lead_weeks} onChange={handleScheduleChange} />
              </label>
              <label>
                Timezone (override)
                <input type="text" name="timezone" value={scheduleForm.timezone} onChange={handleScheduleChange} placeholder="America/Chicago" />
              </label>
              <label>
                RRule (override)
                <input 
                  type="text" 
                  name="rrule" 
                  value={scheduleForm.rrule || ""} 
                  onChange={handleScheduleChange} 
                  placeholder="FREQ=WEEKLY;INTERVAL=52"
                />
                <div style={{ fontSize: "0.85rem", color: "#8193A4", marginTop: "0.25rem" }}>
                  Leave empty to use equipment's default RRule
                </div>
              </label>
              <label>
                Notes
                <textarea name="notes" value={scheduleForm.notes} onChange={handleScheduleChange} rows={3} />
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button type="submit" className="primary" style={{ marginTop: 0 }}>{selectedSchedule ? "Save" : "Create"}</button>
                <button type="button" className="secondary" onClick={() => { resetScheduleForm(); setShowScheduleForm(false); }}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {schedules.length === 0 ? (
          <p className="empty">No schedules yet. Click "Add New Equipment" to get started.</p>
        ) : (
          <div style={{ maxHeight: "420px", overflowY: "auto", overflowX: "hidden" }}>
            <ul className="list">
              {schedules.map(schedule => {
                const equipment = clientEquipments.find(e => e.id === schedule.equipment_id);
                return (
                  <li 
                    key={schedule.id} 
                    ref={el => scheduleRefs.current[schedule.id] = el}
                    className="list-item" 
                    style={{ cursor: "pointer" }} 
                    onClick={() => {
                      setSelectedScheduleDetails(schedule);
                      setShowScheduleDetailsModal(true);
                    }}
                  >
                    <div className="list-main">
                      <div className="list-title">
                        {schedule.equipment_identifier || equipment?.name || `Equipment ID: ${schedule.equipment_id}`}
                      </div>
                      <div className="list-subtitle">
                        {equipment?.name && `Equipment: ${equipment.name} • `}
                        Anchor: {formatDate(schedule.anchor_date)}
                        {schedule.due_date && ` • Due: ${formatDate(schedule.due_date)}`}
                        {schedule.client_name && ` • Client: ${schedule.client_name}`}
                        {schedule.client_address && ` • ${schedule.client_address}`}
                        {schedule.site_name && ` • Site: ${schedule.site_name}`}
                        {schedule.site_address && ` • ${schedule.site_address}`}
                      </div>
                    </div>
                    <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleCompleteSchedule(schedule.id)}>Done</button>
                      <button onClick={() => {
                        if (onNavigateToAddEquipment) {
                          onNavigateToAddEquipment(schedule);
                        } else {
                          startEditSchedule(schedule);
                          setShowScheduleForm(true);
                        }
                      }}>Edit</button>
                      <button className="danger" onClick={() => handleDeleteSchedule(schedule.id)}>Delete</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {showCompletedModal && (
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
        }} onClick={() => setShowCompletedModal(false)}>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, color: "#2D3234" }}>Completed Schedules</h2>
              <button onClick={() => setShowCompletedModal(false)} style={{ color: "#2D3234", border: "1px solid #8193A4" }}>✕</button>
            </div>
            {completedSchedules.length === 0 ? (
              <p className="empty">No completed schedules</p>
            ) : (
              <ul className="list">
                {completedSchedules.map(schedule => {
                  const equipment = clientEquipments.find(e => e.id === schedule.equipment_id);
                  return (
                    <li key={schedule.id} className="list-item" style={{ cursor: "pointer" }} onClick={() => {
                      setSelectedScheduleDetails(schedule);
                      setShowScheduleDetailsModal(true);
                    }}>
                      <div className="list-main">
                        <div className="list-title">
                          {schedule.equipment_identifier || equipment?.name || `Equipment ID: ${schedule.equipment_id}`}
                        </div>
                        <div className="list-subtitle">
                          {equipment?.name && `Equipment: ${equipment.name} • `}
                          Anchor: {formatDate(schedule.anchor_date)}
                          {schedule.due_date && ` • Due: ${formatDate(schedule.due_date)}`}
                          {schedule.client_name && ` • Client: ${schedule.client_name}`}
                          {schedule.client_address && ` • ${schedule.client_address}`}
                          {schedule.site_name && ` • Site: ${schedule.site_name}`}
                          {schedule.site_address && ` • ${schedule.site_address}`}
                          {schedule.completed_at && ` • Completed: ${schedule.completed_at}`}
                        </div>
                      </div>
                      <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleUndoSchedule(schedule.id)}>Undo</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {showScheduleDetailsModal && selectedScheduleDetails && (
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
        }} onClick={() => setShowScheduleDetailsModal(false)}>
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
              <h2 style={{ margin: 0, color: "#2D3234" }}>Schedule Details</h2>
              <button onClick={() => setShowScheduleDetailsModal(false)} style={{ color: "#2D3234", border: "1px solid #8193A4" }}>✕</button>
            </div>
            
            {(() => {
              const schedule = selectedScheduleDetails;
              const equipment = clientEquipments.find(e => e.id === schedule.equipment_id);
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  {/* Schedule Information */}
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Schedule Information</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.9rem" }}>
                      <div><strong>Equipment Name:</strong> {schedule.equipment_identifier || "N/A"}</div>
                      <div><strong>Equipment Type:</strong> {equipment?.name || `ID: ${schedule.equipment_id}`}</div>
                      <div><strong>Anchor Date:</strong> {formatDate(schedule.anchor_date)}</div>
                      {schedule.due_date && <div><strong>Due Date:</strong> {formatDate(schedule.due_date)}</div>}
                      {schedule.lead_weeks && <div><strong>Lead Weeks:</strong> {schedule.lead_weeks}</div>}
                      {schedule.timezone && <div><strong>Timezone:</strong> {schedule.timezone}</div>}
                      {schedule.completed_at && <div><strong>Completed At:</strong> {schedule.completed_at}</div>}
                      {schedule.notes && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <strong>Notes:</strong>
                          <div style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>{schedule.notes}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Client Information */}
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Client Information</h3>
                    <div style={{ fontSize: "0.9rem" }}>
                      <div><strong>Name:</strong> {schedule.client_name || "N/A"}</div>
                      {schedule.client_address && <div><strong>Address:</strong> {schedule.client_address}</div>}
                    </div>
                  </div>

                  {/* Site Information */}
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Site Information</h3>
                    <div style={{ fontSize: "0.9rem" }}>
                      <div><strong>Name:</strong> {schedule.site_name || "N/A"}</div>
                      {schedule.site_address && <div><strong>Address:</strong> {schedule.site_address}</div>}
                    </div>
                  </div>

                  {/* Contacts */}
                  {contactLinks && contactLinks.length > 0 && (
                    <div>
                      <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Contacts</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {contactLinks.map((link, idx) => (
                          <div key={idx} style={{ 
                            padding: "0.75rem", 
                            backgroundColor: "#8193A4", 
                            borderRadius: "0.25rem",
                            fontSize: "0.9rem"
                          }}>
                            <div style={{ fontWeight: "600" }}>
                              {link.first_name} {link.last_name}
                              {link.is_primary && " (Primary)"}
                            </div>
                            <div style={{ marginTop: "0.25rem" }}>
                              <strong>Role:</strong> {link.role} {link.scope === 'CLIENT' ? '(Client)' : '(Site)'}
                            </div>
                            {link.email && <div><strong>Email:</strong> {link.email}</div>}
                            {link.phone && <div><strong>Phone:</strong> {link.phone}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(!contactLinks || contactLinks.length === 0) && (
                    <div>
                      <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Contacts</h3>
                      <div style={{ fontSize: "0.9rem", color: "#8193A4" }}>No contacts available</div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <ContactManagementSection
          site={site}
          client={client}
          contactLinks={contactLinks}
          onRefreshContacts={onRefreshContacts}
            apiCall={apiCall}
            setError={setError}
          />
      </div>
    </div>
  );
}

// Contact Management Section - Simplified with Add New buttons
function ContactManagementSection({ site, client, contactLinks, onRefreshContacts, apiCall, setError }) {
  const [showContactForm, setShowContactForm] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [contactForm, setContactForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    role: "",
    is_primary: false,
  });

  function handleContactChange(e) {
    const { name, value, type, checked } = e.target;
    setContactForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  function resetContactForm() {
    setSelectedContact(null);
    setSelectedLink(null);
    setShowContactForm(false);
    setContactForm({ first_name: "", last_name: "", email: "", phone: "", role: "", is_primary: false });
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
      let contactId;
      
      if (isEdit) {
        // Update existing contact
        const result = await apiCall(`/contacts/${selectedContact.id}`, {
          method: "PUT",
          body: JSON.stringify({
            first_name: contactForm.first_name,
            last_name: contactForm.last_name,
            email: contactForm.email,
            phone: contactForm.phone,
          }),
        });
        contactId = result.id;
        
        // Update the link if it exists
        if (selectedLink) {
          try {
            await apiCall(`/contact-links/${selectedLink.id}`, {
              method: "PUT",
              body: JSON.stringify({
                role: contactForm.role,
                is_primary: contactForm.is_primary,
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
            first_name: contactForm.first_name,
            last_name: contactForm.last_name,
            email: contactForm.email,
            phone: contactForm.phone,
          }),
        });
        contactId = result.id;
        
        // Automatically link it to the site with role and primary status
        if (site) {
          try {
            await apiCall("/contact-links", {
              method: "POST",
              body: JSON.stringify({
                contact_id: contactId,
                scope: "SITE",
                scope_id: site.id,
                role: contactForm.role || "Contact",
                is_primary: contactForm.is_primary,
              }),
            });
          } catch (linkErr) {
            console.warn("Failed to link contact:", linkErr);
          }
        }
      }
      
      await onRefreshContacts(); // Refresh the contact links displayed
      resetContactForm();
    } catch (err) {
      // error already set
    }
  }


  function startEditContact(link) {
    // link is actually a contact link with contact info
    setSelectedContact({ id: link.contact_id });
    setSelectedLink(link);
    setShowContactForm(true);
    setContactForm({
      first_name: link.first_name || "",
      last_name: link.last_name || "",
      email: link.email || "",
      phone: link.phone || "",
      role: link.role || "",
      is_primary: link.is_primary || false,
    });
  }


  async function handleDeleteLink(link) {
    if (!window.confirm("Remove this contact from the site?")) return;
    try {
      const links = await apiCall(`/contact-links?scope=SITE&scope_id=${site.id}`);
      const actualLink = links.find(l => 
        l.contact_id === link.contact_id && 
        l.role === link.role &&
        l.scope === "SITE"
      );
      if (actualLink) {
        await apiCall(`/contact-links/${actualLink.id}`, { method: "DELETE" });
        await onRefreshContacts();
        if (selectedLink?.id === actualLink.id) resetContactForm();
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
          <button className="primary" onClick={() => { resetContactForm(); setShowContactForm(true); }}>+ Add New Contact</button>
        </div>

        {showContactForm && (
          <div style={{ padding: "1rem", borderBottom: "1px solid #8193A4" }}>
            <form onSubmit={handleContactSubmit} className="form">
              <label>
                First Name *
                <input type="text" name="first_name" value={contactForm.first_name} onChange={handleContactChange} required />
              </label>
              <label>
                Last Name *
                <input type="text" name="last_name" value={contactForm.last_name} onChange={handleContactChange} required />
              </label>
              <label>
                Email
                <input type="email" name="email" value={contactForm.email} onChange={handleContactChange} />
              </label>
              <label>
                Phone
                <input type="tel" name="phone" value={contactForm.phone} onChange={handleContactChange} />
              </label>
              <label>
                Role
                <input type="text" name="role" value={contactForm.role} onChange={handleContactChange} placeholder="e.g. Manager, Technician" />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="is_primary" checked={contactForm.is_primary} onChange={handleContactChange} />
                Primary Contact
              </label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button type="submit" className="primary" style={{ marginTop: 0 }}>{selectedContact ? "Save" : "Create"}</button>
                <button type="button" className="secondary" onClick={resetContactForm}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {contactLinks.length === 0 ? (
          <p className="empty">No contacts linked to this site. Click "Add New Contact" to get started.</p>
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
                  <button onClick={() => startEditContact(link)}>Edit</button>
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
function TestTypesTab({ testTypes, onRefresh, apiCall, setError }) {
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
      const endpoint = isEdit ? `/test-types/${selectedType.id}` : "/test-types";
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
      await apiCall(`/test-types/${typeId}`, { method: "DELETE" });
      await onRefresh();
      if (selectedType?.id === typeId) resetForm();
    } catch (err) {
      // error already set
    }
  }

  async function handleSeed() {
    try {
      await apiCall("/test-types/seed", { method: "POST" });
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
          <h2>Equipments ({testTypes.length})</h2>
          <button className="secondary" onClick={onRefresh}>Refresh</button>
        </div>
        {testTypes.length === 0 ? (
          <p className="empty">No equipments yet. Click "Seed Default Equipments" to add defaults.</p>
        ) : (
          <ul className="list">
            {testTypes.map(type => (
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

// Schedules Tab
function SchedulesTab({
  clients,
  sites,
  clientEquipments,
  schedules,
  onRefreshSites,
  onRefreshSchedules,
  onRefreshClients,
  onFetchClientEquipments,
  apiCall,
  setError,
}) {
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [showScheduleDetailsModal, setShowScheduleDetailsModal] = useState(false);
  const [selectedScheduleDetails, setSelectedScheduleDetails] = useState(null);
  const [scheduleContacts, setScheduleContacts] = useState([]);
  const [form, setForm] = useState({
    site_id: "",
    equipment_id: "",
    anchor_date: "",
    lead_weeks: "",
    timezone: "",
    equipment_identifier: "",
    notes: "",
  });

  useEffect(() => {
    onRefreshClients();
    onRefreshSites();
    onRefreshSchedules();
  }, []);

  // Fetch equipments when site changes
  useEffect(() => {
    if (form.site_id) {
      const site = sites.find(s => s.id === parseInt(form.site_id));
      if (site) {
        onFetchClientEquipments(site.client_id);
      }
    } else {
      onFetchClientEquipments(null);
    }
  }, [form.site_id, sites]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setSelectedSchedule(null);
    setForm({
      site_id: selectedSiteId || "",
      equipment_id: "",
      anchor_date: "",
      lead_weeks: "",
      timezone: "",
      equipment_identifier: "",
      notes: "",
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.site_id || !form.equipment_id || !form.anchor_date) {
      setError("Site, equipment, and anchor date are required");
      return;
    }

    try {
      const isEdit = !!selectedSchedule;
      const endpoint = isEdit ? `/schedules/${selectedSchedule.id}` : "/schedules";
      const payload = {
        ...form,
        site_id: parseInt(form.site_id),
        equipment_id: parseInt(form.equipment_id),
        lead_weeks: form.lead_weeks ? parseInt(form.lead_weeks) : null,
        timezone: form.timezone || null,
      };
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onRefreshSchedules();
      resetForm();
    } catch (err) {
      // error already set
    }
  }

  function startEdit(schedule) {
    setSelectedSchedule(schedule);
    setSelectedSiteId(schedule.site_id);
    setForm({
      site_id: schedule.site_id.toString(),
      equipment_id: schedule.equipment_id?.toString() || "",
      anchor_date: schedule.anchor_date || "",
      lead_weeks: schedule.lead_weeks?.toString() || "",
      timezone: schedule.timezone || "",
      equipment_identifier: schedule.equipment_identifier || "",
      notes: schedule.notes || "",
    });
  }

  async function handleDelete(scheduleId) {
    if (!window.confirm("Delete this schedule?")) return;
    try {
      await apiCall(`/schedules/${scheduleId}`, { method: "DELETE" });
      await onRefreshSchedules();
      if (selectedSchedule?.id === scheduleId) resetForm();
    } catch (err) {
      // error already set
    }
  }

  const filteredSchedules = selectedSiteId
    ? schedules.filter(s => s.site_id === parseInt(selectedSiteId))
    : schedules;

  return (
    <div className="two-column">
      <div className="card">
        <div className="card-header">
          <h2>{selectedSchedule ? "Edit Schedule" : "Add Schedule"}</h2>
          {selectedSchedule && (
            <button className="secondary" onClick={resetForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Site *
            <select
              name="site_id"
              value={form.site_id}
              onChange={handleChange}
              required
            >
              <option value="">Select site</option>
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Equipment Name
            <textarea
              name="equipment_identifier"
              value={form.equipment_identifier || ""}
              onChange={handleChange}
              rows={2}
              placeholder="e.g. Scanner Model XYZ, Room 101"
            />
          </label>
          <label>
            Equipment Type *
            <select
              name="equipment_id"
              value={form.equipment_id}
              onChange={handleChange}
              required
              disabled={!form.site_id}
            >
              <option value="">{form.site_id ? "Select equipment" : "Select site first"}</option>
              {clientEquipments.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          <label>
            Anchor Date *
            <input
              type="date"
              name="anchor_date"
              value={form.anchor_date}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Lead Weeks (override)
            <input
              type="number"
              name="lead_weeks"
              value={form.lead_weeks}
              onChange={handleChange}
            />
          </label>
          <label>
            Timezone (override)
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
            {selectedSchedule ? "Save" : "Create"}
            </button>
          </form>
      </div>

      <div className="card">
          <div className="card-header">
          <h2>Schedules ({filteredSchedules.length})</h2>
          <div>
            <select
              value={selectedSiteId || ""}
              onChange={(e) => setSelectedSiteId(e.target.value || null)}
              className="filter-select"
            >
              <option value="">All Sites</option>
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className="secondary" onClick={onRefreshSchedules}>Refresh</button>
          </div>
        </div>
        {filteredSchedules.length === 0 ? (
          <p className="empty">No schedules yet</p>
        ) : (
          <ul className="list">
            {filteredSchedules.map(schedule => {
              const site = sites.find(s => s.id === schedule.site_id);
              return (
                <li key={schedule.id} className="list-item" style={{ cursor: "pointer" }} onClick={async () => {
                  setSelectedScheduleDetails(schedule);
                  setShowScheduleDetailsModal(true);
                  // Fetch contacts for this schedule's site
                  try {
                    const contacts = await apiCall(`/contacts/rollup/site/${schedule.site_id}`);
                    setScheduleContacts(contacts || []);
                  } catch (err) {
                    setScheduleContacts([]);
                  }
                }}>
                  <div className="list-main">
                    <div className="list-title">
                      {schedule.equipment_identifier || schedule.equipment_name || `Equipment ID: ${schedule.equipment_id}`} @ {site?.name}
                    </div>
                    <div className="list-subtitle">
                      {schedule.equipment_name && `Equipment: ${schedule.equipment_name} • `}
                      Anchor: {formatDate(schedule.anchor_date)}
                      {schedule.due_date && ` • Due: ${formatDate(schedule.due_date)}`}
                      {schedule.client_name && ` • Client: ${schedule.client_name}`}
                      {schedule.client_address && ` • ${schedule.client_address}`}
                      {schedule.site_name && ` • Site: ${schedule.site_name}`}
                      {schedule.site_address && ` • ${schedule.site_address}`}
                    </div>
                  </div>
                  <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => startEdit(schedule)}>Edit</button>
                    <button className="danger" onClick={() => handleDelete(schedule.id)}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showScheduleDetailsModal && selectedScheduleDetails && (
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
        }} onClick={() => setShowScheduleDetailsModal(false)}>
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
              <h2 style={{ margin: 0, color: "#2D3234" }}>Schedule Details</h2>
              <button onClick={() => setShowScheduleDetailsModal(false)} style={{ color: "#2D3234", border: "1px solid #8193A4" }}>✕</button>
            </div>
            
            {(() => {
              const schedule = selectedScheduleDetails;
              const equipment = clientEquipments.find(e => e.id === schedule.equipment_id);
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  {/* Schedule Information */}
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Schedule Information</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.9rem" }}>
                      <div><strong>Equipment Name:</strong> {schedule.equipment_identifier || "N/A"}</div>
                      <div><strong>Equipment Type:</strong> {schedule.equipment_name || equipment?.name || `ID: ${schedule.equipment_id}`}</div>
                      <div><strong>Anchor Date:</strong> {formatDate(schedule.anchor_date)}</div>
                      {schedule.due_date && <div><strong>Due Date:</strong> {formatDate(schedule.due_date)}</div>}
                      {schedule.lead_weeks && <div><strong>Lead Weeks:</strong> {schedule.lead_weeks}</div>}
                      {schedule.timezone && <div><strong>Timezone:</strong> {schedule.timezone}</div>}
                      {schedule.notes && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <strong>Notes:</strong>
                          <div style={{ marginTop: "0.25rem", whiteSpace: "pre-wrap" }}>{schedule.notes}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Client Information */}
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Client Information</h3>
                    <div style={{ fontSize: "0.9rem" }}>
                      <div><strong>Name:</strong> {schedule.client_name || "N/A"}</div>
                      {schedule.client_address && <div><strong>Address:</strong> {schedule.client_address}</div>}
                    </div>
                  </div>

                  {/* Site Information */}
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Site Information</h3>
                    <div style={{ fontSize: "0.9rem" }}>
                      <div><strong>Name:</strong> {schedule.site_name || "N/A"}</div>
                      {schedule.site_address && <div><strong>Address:</strong> {schedule.site_address}</div>}
                    </div>
                  </div>

                  {/* Contacts */}
                  {scheduleContacts && scheduleContacts.length > 0 && (
                    <div>
                      <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Contacts</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {scheduleContacts.map((link, idx) => (
                          <div key={idx} style={{ 
                            padding: "0.75rem", 
                            backgroundColor: "#8193A4", 
                            borderRadius: "0.25rem",
                            fontSize: "0.9rem"
                          }}>
                            <div style={{ fontWeight: "600" }}>
                              {link.first_name} {link.last_name}
                              {link.is_primary && " (Primary)"}
                            </div>
                            <div style={{ marginTop: "0.25rem" }}>
                              <strong>Role:</strong> {link.role} {link.scope === 'CLIENT' ? '(Client)' : '(Site)'}
                            </div>
                            {link.email && <div><strong>Email:</strong> {link.email}</div>}
                            {link.phone && <div><strong>Phone:</strong> {link.phone}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(!scheduleContacts || scheduleContacts.length === 0) && (
                    <div>
                      <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234", fontSize: "1.1rem" }}>Contacts</h3>
                      <div style={{ fontSize: "0.9rem", color: "#8193A4" }}>No contacts available</div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// Work Orders Tab
function WorkOrdersTab({
  schedules,
  workOrders,
  onRefresh,
  onRefreshSchedules,
  apiCall,
  setError,
}) {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState({
    schedule_id: "",
    due_date: "",
    planned_date: "",
    invoice_ref: "",
    notes: "",
  });

  useEffect(() => {
    onRefreshSchedules();
    onRefresh(null, null);
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setSelectedOrder(null);
    setForm({
      schedule_id: "",
      due_date: "",
      planned_date: "",
      invoice_ref: "",
      notes: "",
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.schedule_id || !form.due_date) {
      setError("Schedule and due date are required");
      return;
    }

    try {
      const isEdit = !!selectedOrder;
      const endpoint = isEdit ? `/work-orders/${selectedOrder.id}` : "/work-orders";
      const payload = {
        ...form,
        schedule_id: parseInt(form.schedule_id),
        planned_date: form.planned_date || null,
      };
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      const validScheduleId = selectedScheduleId && (typeof selectedScheduleId === 'number' ? selectedScheduleId : 
                             (!isNaN(parseInt(selectedScheduleId)) ? parseInt(selectedScheduleId) : null));
      await onRefresh(validScheduleId, statusFilter || null);
      resetForm();
    } catch (err) {
      // error already set
    }
  }

  async function handleCreateFromSchedule(scheduleId) {
    try {
      await apiCall(`/work-orders/from-schedule/${scheduleId}`, { method: "POST" });
      const validScheduleId = selectedScheduleId && (typeof selectedScheduleId === 'number' ? selectedScheduleId : 
                             (!isNaN(parseInt(selectedScheduleId)) ? parseInt(selectedScheduleId) : null));
      await onRefresh(validScheduleId, statusFilter || null);
      setError("");
    } catch (err) {
      // error already set
    }
  }

  function startEdit(order) {
    setSelectedOrder(order);
    setForm({
      schedule_id: order.schedule_id.toString(),
      due_date: order.due_date || "",
      planned_date: order.planned_date || "",
      invoice_ref: order.invoice_ref || "",
      notes: order.notes || "",
    });
  }

  async function handleUpdateStatus(orderId, newStatus) {
    try {
      await apiCall(`/work-orders/${orderId}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      const validScheduleId = selectedScheduleId && (typeof selectedScheduleId === 'number' ? selectedScheduleId : 
                             (!isNaN(parseInt(selectedScheduleId)) ? parseInt(selectedScheduleId) : null));
      await onRefresh(validScheduleId, statusFilter || null);
    } catch (err) {
      // error already set
    }
  }

  async function handleMarkDone(orderId) {
    try {
      await apiCall(`/work-orders/${orderId}`, {
        method: "PUT",
        body: JSON.stringify({ done_date: new Date().toISOString().split("T")[0] }),
      });
      const validScheduleId = selectedScheduleId && (typeof selectedScheduleId === 'number' ? selectedScheduleId : 
                             (!isNaN(parseInt(selectedScheduleId)) ? parseInt(selectedScheduleId) : null));
      await onRefresh(validScheduleId, statusFilter || null);
    } catch (err) {
      // error already set
    }
  }

  async function handleDelete(orderId) {
    if (!window.confirm("Delete this work order?")) return;
    try {
      await apiCall(`/work-orders/${orderId}`, { method: "DELETE" });
      const validScheduleId = selectedScheduleId && (typeof selectedScheduleId === 'number' ? selectedScheduleId : 
                             (!isNaN(parseInt(selectedScheduleId)) ? parseInt(selectedScheduleId) : null));
      await onRefresh(validScheduleId, statusFilter || null);
      if (selectedOrder?.id === orderId) resetForm();
    } catch (err) {
      // error already set
    }
  }

  let filteredOrders = workOrders;
  if (selectedScheduleId) {
    filteredOrders = filteredOrders.filter(o => o.schedule_id === parseInt(selectedScheduleId));
  }
  if (statusFilter) {
    filteredOrders = filteredOrders.filter(o => o.status === statusFilter);
  }

  return (
    <div className="two-column">
      <div className="card">
        <div className="card-header">
          <h2>{selectedOrder ? "Edit Work Order" : "Add Work Order"}</h2>
          {selectedOrder && (
            <button className="secondary" onClick={resetForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Schedule *
            <select
              name="schedule_id"
              value={form.schedule_id}
              onChange={handleChange}
              required
            >
              <option value="">Select schedule</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>
                  Schedule #{s.id} - {s.equipment_name || `Equipment ${s.equipment_id}`} {s.site_name ? `@ ${s.site_name}` : ""} {s.due_date ? `(${formatDate(s.due_date)})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due Date *
            <input
              type="date"
              name="due_date"
              value={form.due_date}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            Planned Date
            <input
              type="date"
              name="planned_date"
              value={form.planned_date}
              onChange={handleChange}
            />
          </label>
          <label>
            Invoice Reference
            <input
              type="text"
              name="invoice_ref"
              value={form.invoice_ref}
              onChange={handleChange}
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
            {selectedOrder ? "Save" : "Create"}
            </button>
        </form>
          </div>

      <div className="card">
        <div className="card-header">
          <h2>Work Orders ({filteredOrders.length})</h2>
          <div>
            <select
              value={selectedScheduleId || ""}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedScheduleId(value ? parseInt(value) : null);
              }}
              className="filter-select"
            >
              <option value="">All Schedules</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>Schedule #{s.id}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="filter-select"
            >
              <option value="">All Status</option>
              <option value="PLANNED">Planned</option>
              <option value="DUE">Due</option>
              <option value="DONE">Done</option>
            </select>
            {filteredOrders.length > 0 && (
              <a
                href={`${API_BASE}/work-orders/export/ics?${selectedScheduleId ? `schedule_id=${selectedScheduleId}` : ''}`}
                className="secondary"
                style={{ textDecoration: 'none', marginRight: '0.5rem' }}
              >
                Export ICS
              </a>
            )}
            <button className="secondary" onClick={() => {
              const validScheduleId = selectedScheduleId && (typeof selectedScheduleId === 'number' ? selectedScheduleId : 
                                     (!isNaN(parseInt(selectedScheduleId)) ? parseInt(selectedScheduleId) : null));
              onRefresh(validScheduleId, statusFilter || null);
            }}>Refresh</button>
          </div>
        </div>
        {filteredOrders.length === 0 ? (
          <p className="empty">No work orders yet</p>
        ) : (
          <ul className="list">
            {filteredOrders.map(order => {
              const schedule = schedules.find(s => s.id === order.schedule_id);
              const statusClass = order.status === "DONE" ? "done" : order.status === "DUE" ? "due" : "planned";
              return (
                <li key={order.id} className={`list-item ${statusClass}`}>
                  <div className="list-main">
                    <div className="list-title">
                      Work Order #{order.id} - {order.status}
                    </div>
                    <div className="list-subtitle">
                      Due: {formatDate(order.due_date)}
                      {order.planned_date && ` • Planned: ${formatDate(order.planned_date)}`}
                      {order.done_date && ` • Done: ${formatDate(order.done_date)}`}
                      {schedule && ` • Schedule #${schedule.id}`}
                    </div>
                  </div>
                  <div className="list-actions">
                    {order.status !== "DONE" && (
                      <button onClick={() => handleMarkDone(order.id)}>Mark Done</button>
                    )}
                    <button onClick={() => startEdit(order)}>Edit</button>
                    <button className="danger" onClick={() => handleDelete(order.id)}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #8193A4" }}>
          <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Create from Schedule</h3>
          {schedules.map(schedule => (
            <div key={schedule.id} style={{ marginBottom: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: "0.85rem" }}>
                Schedule #{schedule.id} - {schedule.equipment_name || `Equipment ${schedule.equipment_id}`} {schedule.site_name ? `@ ${schedule.site_name}` : ""} {schedule.due_date ? `(Due: ${formatDate(schedule.due_date)})` : ""}
              </span>
                    <button
                className="secondary"
                onClick={() => handleCreateFromSchedule(schedule.id)}
                    >
                Create Work Order
                    </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Quick Views Tab
function QuickViewsTab({ apiCall, setError, clients, sites, onNavigateToSchedule, onNavigateToAddEquipment }) {
  const [quickViewTab, setQuickViewTab] = useState("all-equipments"); // "all-equipments", "upcoming", "overdue", "future"
  const [dueThisMonth, setDueThisMonth] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [future, setFuture] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [upcomingStartDate, setUpcomingStartDate] = useState("");
  const [upcomingEndDate, setUpcomingEndDate] = useState("");

  // All Equipments tab state
  const [allEquipments, setAllEquipments] = useState([]);

  async function fetchUpcoming() {
    setLoading(true);
    setErrorMsg("");
    try {
      let url = "/work-orders/upcoming";
      let schedUrl = "/schedules/upcoming";
      
      if (upcomingStartDate) {
        let endDate = upcomingEndDate;
        // If start date is set but no end date, use start date + 14 days
        if (!endDate) {
          const startDate = new Date(upcomingStartDate);
          startDate.setDate(startDate.getDate() + 14); // Add 14 days
          endDate = startDate.toISOString().split('T')[0];
        }
        url += `?start_date=${upcomingStartDate}&end_date=${endDate}`;
        schedUrl += `?start_date=${upcomingStartDate}&end_date=${endDate}`;
      } else {
        // Default to 2 weeks from today
        url += "?weeks=2";
        schedUrl += "?weeks=2";
      }
      
      const upWO = await apiCall(url).catch(() => []);
      
      if (!upWO || upWO.length === 0) {
        // Fallback to schedules
        const upSched = await apiCall(schedUrl).catch(() => []);
        setUpcoming(Array.isArray(upSched) ? upSched : []);
      } else {
        setUpcoming(Array.isArray(upWO) ? upWO : []);
      }
    } catch (err) {
      const errorMessage = err.message || "Failed to load upcoming data";
      setErrorMsg(errorMessage);
      setError(errorMessage);
      console.error("Error fetching upcoming data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (quickViewTab !== "all-equipments") {
      if (quickViewTab === "upcoming") {
        fetchUpcoming();
      } else {
        fetchAll();
      }
    } else {
      fetchAllEquipments();
    }
  }, [quickViewTab, upcomingStartDate, upcomingEndDate]);

  // Fetch all equipments when tab is selected
  async function fetchAllEquipments() {
    setLoading(true);
    try {
      const data = await apiCall("/schedules");
      setAllEquipments(data || []);
    } catch (err) {
      setError(err.message || "Failed to fetch equipments");
      setAllEquipments([]);
    } finally {
      setLoading(false);
    }
  }


  async function fetchAll() {
    setLoading(true);
    setErrorMsg("");
    try {
      // Try to fetch work orders first, fallback to schedules if no work orders exist
      const [dueWO, overWO] = await Promise.all([
        apiCall("/work-orders/due-this-month").catch(() => []),
        apiCall("/work-orders/overdue").catch(() => []),
      ]);
      
      let dueSched, overSched;
      
      // If no work orders, use schedules instead
      if ((!dueWO || dueWO.length === 0) && (!overWO || overWO.length === 0)) {
        [dueSched, overSched] = await Promise.all([
          apiCall("/schedules/due-this-month").catch(() => []),
          apiCall("/schedules/overdue").catch(() => []),
        ]);
        setDueThisMonth(Array.isArray(dueSched) ? dueSched : []);
        setOverdue(Array.isArray(overSched) ? overSched : []);
      } else {
        setDueThisMonth(Array.isArray(dueWO) ? dueWO : []);
        setOverdue(Array.isArray(overWO) ? overWO : []);
      }
      
      // Fetch upcoming separately if on upcoming tab
      if (quickViewTab === "upcoming") {
        await fetchUpcoming();
      }
      
      // Fetch future - if upcomingStartDate is set and on future tab, use it to calculate future range
      if (quickViewTab === "future") {
        let futureStartDate, futureEndDate;
        if (upcomingStartDate) {
          // Future should be from (start_date + 14 days) to (start_date + 14 days + 2 weeks)
          const startDate = new Date(upcomingStartDate);
          startDate.setDate(startDate.getDate() + 14); // Add 14 days
          futureStartDate = startDate.toISOString().split('T')[0];
          
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 14); // Add another 2 weeks (14 days)
          futureEndDate = endDate.toISOString().split('T')[0];
        }
        
        // Try work orders first
        let futureWOUrl = "/work-orders/upcoming";
        if (futureStartDate && futureEndDate) {
          futureWOUrl += `?start_date=${futureStartDate}&end_date=${futureEndDate}`;
        } else {
          futureWOUrl += "?weeks=52";
        }
        
        const futureWO = await apiCall(futureWOUrl).catch(() => []);
        
        if (!futureWO || futureWO.length === 0) {
          // Fallback to schedules
          let futureSchedUrl = "/schedules/upcoming";
          if (futureStartDate && futureEndDate) {
            futureSchedUrl += `?start_date=${futureStartDate}&end_date=${futureEndDate}`;
          } else {
            futureSchedUrl += "?weeks=52";
          }
          
          const futureSched = await apiCall(futureSchedUrl).catch(() => []);
          const futureArray = Array.isArray(futureSched) ? futureSched : [];
          
          // If not using date range, filter out items that are in upcoming
          if (!futureStartDate || !futureEndDate) {
            // First fetch upcoming to know what to filter out
            await fetchUpcoming();
            const currentUpcoming = upcoming.length > 0 ? upcoming : [];
            const upcomingIds = new Set(currentUpcoming.map(item => item.id));
            setFuture(futureArray.filter(item => !upcomingIds.has(item.id)));
          } else {
            setFuture(futureArray);
          }
        } else {
          // Use work orders
          const futureArray = Array.isArray(futureWO) ? futureWO : [];
          
          // If not using date range, filter out items that are in upcoming
          if (!futureStartDate || !futureEndDate) {
            // First fetch upcoming to know what to filter out
            await fetchUpcoming();
            const currentUpcoming = upcoming.length > 0 ? upcoming : [];
            const upcomingIds = new Set(currentUpcoming.map(item => item.id));
            setFuture(futureArray.filter(item => !upcomingIds.has(item.id)));
          } else {
            setFuture(futureArray);
          }
        }
      } else {
        // For other tabs, fetch future normally
        const futureData = await apiCall("/schedules/upcoming?weeks=52").catch(() => []);
        const futureArray = Array.isArray(futureData) ? futureData : [];
        const currentUpcoming = upcoming.length > 0 ? upcoming : [];
        const upcomingIds = new Set(currentUpcoming.map(item => item.id));
        setFuture(futureArray.filter(item => !upcomingIds.has(item.id)));
      }
    } catch (err) {
      const errorMessage = err.message || "Failed to load data";
      setErrorMsg(errorMessage);
      setError(errorMessage);
      console.error("Error fetching data:", err);
      // Set empty arrays on error
      setDueThisMonth([]);
      setOverdue([]);
      setUpcoming([]);
      setFuture([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSchedule(scheduleId) {
    if (!window.confirm("Delete this schedule?")) return;
    try {
      await apiCall(`/schedules/${scheduleId}`, { method: "DELETE" });
      await fetchAllEquipments();
    } catch (err) {
      // error already set
    }
  }

  function resetScheduleForm() {
    setSelectedSchedule(null);
    setShowScheduleForm(false);
    setSelectedClientId("");
    setSelectedSiteId("");
    setScheduleForm({
      equipment_id: "",
      anchor_date: "",
      due_date: "",
      lead_weeks: "",
      timezone: "",
      equipment_identifier: "",
      notes: "",
      rrule: "",
    });
  }

  if (loading && quickViewTab !== "all-equipments") return <div className="card"><p>Loading...</p></div>;

  function renderWorkOrderList(items, className = "") {
    return (
      <ul className="list">
        {items.map(item => (
          <li 
            key={item.id} 
            className={`list-item ${className}`}
            style={{ cursor: item.schedule_id || item.site_id ? "pointer" : "default" }}
            onClick={() => {
              if (item.schedule_id && item.site_id && onNavigateToSchedule) {
                onNavigateToSchedule(item.schedule_id, item.site_id);
              } else if (item.site_id && item.id && !item.status && onNavigateToSchedule) {
                onNavigateToSchedule(item.id, item.site_id);
              }
            }}
          >
            <div className="list-main">
              <div className="list-title">{item.equipment_name || 'Unknown'} @ {item.site_name}</div>
              <div className="list-subtitle">
                Client: {item.client_name} • Due: {formatDate(item.due_date)} {item.status ? `• Status: ${item.status}` : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      {errorMsg && (
        <div className="card" style={{ marginBottom: "1rem", backgroundColor: "#D7E5D8", border: "1px solid #c94a4a" }}>
          <p style={{ color: "#b03a3a" }}>Error: {errorMsg}</p>
        </div>
      )}

      <nav className="tabs" style={{ marginBottom: "1rem" }}>
        <button
          className={quickViewTab === "all-equipments" ? "active" : ""}
          onClick={() => setQuickViewTab("all-equipments")}
        >
          All Equipments
        </button>
        <button
          className={quickViewTab === "upcoming" ? "active" : ""}
          onClick={() => setQuickViewTab("upcoming")}
        >
          Upcoming
        </button>
        <button
          className={quickViewTab === "overdue" ? "active" : ""}
          onClick={() => setQuickViewTab("overdue")}
        >
          Overdue
        </button>
        <button
          className={quickViewTab === "future" ? "active" : ""}
          onClick={() => setQuickViewTab("future")}
        >
          Future
        </button>
      </nav>

      {quickViewTab === "all-equipments" && (
        <div className="card">
          <div className="card-header">
            <h2>All Equipments</h2>
            <button className="primary" onClick={() => {
              if (onNavigateToAddEquipment) {
                onNavigateToAddEquipment(null);
              }
            }}>
              + Add New Equipment
            </button>
          </div>

          <div style={{ padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0 }}>All Equipments ({allEquipments.length})</h3>
              <button className="secondary" onClick={fetchAllEquipments}>Refresh</button>
            </div>
            {loading ? (
              <p>Loading...</p>
            ) : allEquipments.length === 0 ? (
              <p className="empty">No equipments found</p>
            ) : (
              <ul className="list">
                {allEquipments.map(schedule => {
                  // The API returns equipment_name, client_name, site_name, etc. in the schedule object
                  return (
                    <li key={schedule.id} className="list-item">
                      <div className="list-main">
                        <div className="list-title">
                          {schedule.equipment_identifier || schedule.equipment_name || `Equipment ID: ${schedule.equipment_id}`}
                        </div>
                        <div className="list-subtitle">
                          {schedule.equipment_name && `Equipment: ${schedule.equipment_name} • `}
                          Anchor: {formatDate(schedule.anchor_date)}
                          {schedule.due_date && ` • Due: ${formatDate(schedule.due_date)}`}
                          {schedule.client_name && ` • Client: ${schedule.client_name}`}
                          {schedule.client_address && ` • ${schedule.client_address}`}
                          {schedule.site_name && ` • Site: ${schedule.site_name}`}
                          {schedule.site_address && ` • ${schedule.site_address}`}
                        </div>
                      </div>
                      <div className="list-actions">
                        <button onClick={() => {
                          if (onNavigateToAddEquipment) {
                            onNavigateToAddEquipment(schedule);
                          }
                        }}>Edit</button>
                        <button className="danger" onClick={() => handleDeleteSchedule(schedule.id)}>Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {quickViewTab === "upcoming" && (
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
            <p className="empty">No upcoming work orders</p>
          ) : (
            renderWorkOrderList(upcoming, "planned")
          )}
        </div>
      )}

      {quickViewTab === "overdue" && (
        <div className="card">
          <div className="card-header">
            <h2>Overdue</h2>
            <div>
              <button className="secondary" onClick={fetchAll}>Refresh</button>
            </div>
          </div>
          {overdue.length === 0 ? (
            <p className="empty">No overdue work orders</p>
          ) : (
            renderWorkOrderList(overdue, "due")
          )}
        </div>
      )}

      {quickViewTab === "future" && (
        <div className="card">
          <div className="card-header">
            <h2>Future</h2>
            <div>
              <button className="secondary" onClick={fetchAll}>Refresh</button>
            </div>
          </div>
          {future.length === 0 ? (
            <p className="empty">No future work orders</p>
          ) : (
            renderWorkOrderList(future, "planned")
          )}
        </div>
      )}
    </div>
  );
}

// Add Equipment Page
function AddEquipmentPage({ apiCall, setError, clients, sites, equipmentToEdit, previousView, onBack, onSuccess }) {
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [clientEquipments, setClientEquipments] = useState([]);
  const [availableSites, setAvailableSites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    equipment_id: "",
    anchor_date: "",
    due_date: "",
    lead_weeks: "",
    timezone: "",
    equipment_identifier: "",
    notes: "",
    rrule: "",
  });

  useEffect(() => {
    async function loadEquipmentData() {
      if (equipmentToEdit) {
        // Check if this is a new equipment with pre-selected client/site (from site-details)
        if (equipmentToEdit.client && equipmentToEdit.site) {
          setSelectedClientId(equipmentToEdit.client.id.toString());
          setSelectedSiteId(equipmentToEdit.site.id.toString());
          await fetchSitesForClient(equipmentToEdit.client.id);
          await fetchClientEquipments(equipmentToEdit.client.id);
        } else if (equipmentToEdit.id) {
          // This is editing an existing schedule
          // Try to find site in props first, otherwise fetch from API
          let site = sites.find(s => s.id === equipmentToEdit.site_id);
          if (!site && equipmentToEdit.site_id) {
            // Fetch site from API if not in props
            try {
              site = await apiCall(`/sites/${equipmentToEdit.site_id}`);
            } catch (err) {
              console.error("Failed to fetch site:", err);
            }
          }
          
          if (site) {
            const clientId = site.client_id.toString();
            setSelectedClientId(clientId);
            setSelectedSiteId(site.id.toString());
            // Fetch sites and equipments for this client
            await fetchSitesForClient(site.client_id);
            await fetchClientEquipments(site.client_id);
          }
          
          let equipmentIdentifier = "";
          if (equipmentToEdit.equipment_identifier !== undefined && equipmentToEdit.equipment_identifier !== null) {
            if (typeof equipmentToEdit.equipment_identifier !== 'number') {
              equipmentIdentifier = String(equipmentToEdit.equipment_identifier);
            }
          }
          setScheduleForm({
            equipment_id: equipmentToEdit.equipment_id?.toString() || "",
            anchor_date: equipmentToEdit.anchor_date || "",
            due_date: equipmentToEdit.due_date || "",
            lead_weeks: equipmentToEdit.lead_weeks?.toString() || "",
            timezone: equipmentToEdit.timezone || "",
            equipment_identifier: equipmentIdentifier,
            notes: equipmentToEdit.notes || "",
            rrule: equipmentToEdit.rrule || "",
          });
        }
      }
    }
    loadEquipmentData();
  }, [equipmentToEdit, sites, apiCall]);

  // Fetch sites and client equipments when client changes
  useEffect(() => {
    if (selectedClientId) {
      fetchSitesForClient(selectedClientId);
      fetchClientEquipments(selectedClientId);
    } else {
      setAvailableSites([]);
      setClientEquipments([]);
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

  async function fetchClientEquipments(clientId) {
    try {
      const data = await apiCall(`/clients/${clientId}/equipments`);
      setClientEquipments(data || []);
    } catch (err) {
      setClientEquipments([]);
    }
  }

  function handleScheduleChange(e) {
    const { name, value } = e.target;
    setScheduleForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleScheduleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!scheduleForm.equipment_id || !scheduleForm.anchor_date || !selectedSiteId) {
      setError("Equipment Type, Anchor Date, Client, and Site are required");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...scheduleForm,
        site_id: parseInt(selectedSiteId),
        equipment_id: parseInt(scheduleForm.equipment_id),
        lead_weeks: scheduleForm.lead_weeks ? parseInt(scheduleForm.lead_weeks) : null,
        timezone: scheduleForm.timezone || null,
        equipment_identifier: scheduleForm.equipment_identifier || null,
      };

      if (equipmentToEdit?.id) {
        // Editing an existing schedule
        await apiCall(`/schedules/${equipmentToEdit.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        // Creating a new schedule
        await apiCall("/schedules", {
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
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>
          ← Back {previousView === "site-details" ? "to Site Details" : "to Quick Views"}
        </button>
        <h2 style={{ margin: 0 }}>{equipmentToEdit?.id ? "Edit Equipment" : "Add New Equipment"}</h2>
      </div>

      <div className="card">
        <form onSubmit={handleScheduleSubmit} className="form">
          <label>
            Client *
            <select
              value={selectedClientId}
              onChange={(e) => {
                setSelectedClientId(e.target.value);
                setSelectedSiteId(""); // Reset site when client changes
              }}
              disabled={!!equipmentToEdit?.id}
              required
              style={{ width: "100%" }}
            >
              <option value="">Select a client</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
          <label>
            Site *
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              disabled={!selectedClientId || !!equipmentToEdit?.id}
              required
              style={{ width: "100%" }}
            >
              <option value="">Select a site</option>
              {availableSites.map(site => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
          </label>
          <label>
            Equipment Name
            <textarea 
              name="equipment_identifier" 
              value={scheduleForm.equipment_identifier || ""} 
              onChange={handleScheduleChange} 
              rows={2}
              placeholder="e.g. Scanner Model XYZ, Room 101"
            />
          </label>
          <label>
            Equipment Type *
            <select name="equipment_id" value={scheduleForm.equipment_id} onChange={handleScheduleChange} required style={{ width: "100%" }} disabled={!selectedClientId}>
              <option value="">Select equipment</option>
              {clientEquipments.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            {scheduleForm.equipment_id && (() => {
              const selectedEq = clientEquipments.find(e => e.id === parseInt(scheduleForm.equipment_id));
              return selectedEq && selectedEq.rrule ? (
                <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#8193A4" }}>
                  Equipment RRule: {selectedEq.rrule}
                </div>
              ) : null;
            })()}
          </label>
          <label>
            Anchor Date *
            <input
              type="date"
              name="anchor_date"
              value={scheduleForm.anchor_date}
              onChange={handleScheduleChange}
              required
            />
          </label>
          <label>
            Due Date
            <input
              type="date"
              name="due_date"
              value={scheduleForm.due_date}
              onChange={handleScheduleChange}
            />
          </label>
          <label>
            Lead Weeks
            <input
              type="number"
              name="lead_weeks"
              value={scheduleForm.lead_weeks}
              onChange={handleScheduleChange}
              min="0"
            />
          </label>
          <label>
            Timezone
            <input
              type="text"
              name="timezone"
              value={scheduleForm.timezone}
              onChange={handleScheduleChange}
              placeholder="America/Chicago"
            />
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              value={scheduleForm.notes}
              onChange={handleScheduleChange}
              rows={3}
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Saving..." : (equipmentToEdit ? "Save" : "Create")}
            </button>
            <button type="button" className="secondary" onClick={onBack} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
      message += `Created: ${stats.equipments_created || 0} equipment type(s), ${stats.schedules_created || 0} schedule(s).\n`;
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
      message += `Created: ${stats.clients_created || 0} client(s), ${stats.sites_created || 0} site(s), ${stats.equipments_created || 0} equipment type(s), ${stats.schedules_created || 0} schedule(s).\n`;
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
                Import equipment schedules from Excel file. Required columns: Client, Site, Equipment (identifier), Equipment Name, Anchor Date.
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
                Import equipment schedules from Excel file. Required columns: Client, Site, Equipment (identifier), Equipment Name, Anchor Date.
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
                Export all equipment schedules to Excel file.
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

// Reports Tab
function ReportsTab({ apiCall, setError }) {
  const [clientReport, setClientReport] = useState([]);
  const [modalityReport, setModalityReport] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchReports();
  }, []);

  async function fetchReports() {
    setLoading(true);
    try {
      const [client, equipment] = await Promise.all([
        apiCall("/reports/by-client"),
        apiCall("/reports/by-equipment"),
      ]);
      setClientReport(client);
      setModalityReport(equipment);
    } catch (err) {
      // error already set
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="card"><p>Loading...</p></div>;

  return (
    <div className="reports-layout">
      <div className="card">
        <div className="card-header">
          <h2>Report by Client</h2>
          <button className="secondary" onClick={fetchReports}>Refresh</button>
        </div>
        {clientReport.length === 0 ? (
          <p className="empty">No data</p>
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Sites</th>
                <th>Schedules</th>
                <th>Work Orders</th>
                <th>Overdue</th>
                <th>Due This Month</th>
              </tr>
            </thead>
            <tbody>
              {clientReport.map(r => (
                <tr key={r.client_id}>
                  <td>{r.client_name}</td>
                  <td>{r.total_sites}</td>
                  <td>{r.total_schedules}</td>
                  <td>{r.total_work_orders}</td>
                  <td className={r.overdue_count > 0 ? "due" : ""}>{r.overdue_count}</td>
                  <td>{r.due_this_month_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Report by Equipment</h2>
        </div>
        {modalityReport.length === 0 ? (
          <p className="empty">No data</p>
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Schedules</th>
                <th>Work Orders</th>
                <th>Overdue</th>
                <th>Due This Month</th>
              </tr>
            </thead>
            <tbody>
              {modalityReport.map(r => (
                <tr key={r.equipment_id}>
                  <td>{r.equipment_name}</td>
                  <td>{r.total_schedules}</td>
                  <td>{r.total_work_orders}</td>
                  <td className={r.overdue_count > 0 ? "due" : ""}>{r.overdue_count}</td>
                  <td>{r.due_this_month_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default App;
