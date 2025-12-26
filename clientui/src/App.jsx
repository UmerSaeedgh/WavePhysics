import { useEffect, useState } from "react";
import "./App.css";
import wavePhysicsLogo from "./assets/image.png";
import { API_BASE } from "./config";
import LoginView from "./components/LoginView";
import ClientsListView from "./components/ClientsListView";
import EditClientPage from "./components/EditClientPage";
import ClientSitesView from "./components/ClientSitesView";
import EditSitePage from "./components/EditSitePage";
import EditContactPage from "./components/EditContactPage";
import AllEquipmentsView from "./components/AllEquipmentsView";
import UpcomingView from "./components/UpcomingView";
import AddEquipmentPage from "./components/AddEquipmentPage";
import UserView from "./components/UserView";
import CompletedView from "./components/CompletedView";

function App() {
  // Authentication state
  const [authToken, setAuthToken] = useState(() => {
    return localStorage.getItem("authToken") || null;
  });
  const [currentUser, setCurrentUser] = useState(() => {
    const stored = localStorage.getItem("currentUser");
    return stored ? JSON.parse(stored) : null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(!!authToken);
  const [loginTime, setLoginTime] = useState(null); // Track when user logged in

  const [view, setView] = useState("clients"); // "clients", "client-sites", "all-equipments", "upcoming", "overdue", "completed", "admin", "user", "add-equipment", "edit-client", "edit-site", "edit-contact"
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
  const [completions, setCompletions] = useState([]);
  const [upcomingDate, setUpcomingDate] = useState(() => {
    // Default to today's date
    return new Date().toISOString().split('T')[0];
  });
  const [upcomingInterval, setUpcomingInterval] = useState(2); // Default to 2 weeks

  useEffect(() => {
    if (isAuthenticated && authToken) {
      fetchClients();
      fetchEquipmentTypes();
      // Fetch counts silently (without showing loading state)
      fetchAllEquipments(true);
      fetchUpcoming(true);
      fetchOverdue(true);
    }
  }, [isAuthenticated, authToken]);

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
  }, [view, upcomingDate, upcomingInterval]);


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

  async function fetchCompletions(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const data = await apiCall("/equipment-completions").catch(() => []);
      setCompletions(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMessage = err.message || "Failed to load completion data";
      if (!silent) setError(errorMessage);
      if (!silent) console.error("Error fetching completions:", err);
      setCompletions([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Authentication functions
  async function handleLogin(username, password) {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Login failed" }));
        throw new Error(errorData.detail || "Invalid username or password");
      }

      const data = await response.json();
      const token = data.token;
      setAuthToken(token);
      setCurrentUser(data.user);
      setIsAuthenticated(true);
      setLoginTime(Date.now()); // Record login time to prevent immediate logout
      localStorage.setItem("authToken", token);
      localStorage.setItem("currentUser", JSON.stringify(data.user));
      setError("");
      // Fetch data immediately after login using the token directly
      // Pass token to apiCall to avoid closure issue with state
      try {
        // Calculate upcoming date range (default to today + 2 weeks)
        const today = new Date().toISOString().split('T')[0];
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + (2 * 7)); // 2 weeks
        const endDateStr = endDate.toISOString().split('T')[0];
        
        // Fetch data with error handling - don't fail login if data fetch fails
        const fetchPromises = [
          apiCall("/clients", {}, token).catch(err => { console.error("Failed to fetch clients:", err); return []; }),
          apiCall("/equipment-types?active_only=true", {}, token).catch(err => { console.error("Failed to fetch equipment types:", err); return []; }),
          apiCall("/equipment-records", {}, token).catch(err => { console.error("Failed to fetch equipment records:", err); return []; }),
          apiCall(`/equipment-records/upcoming?start_date=${today}&end_date=${endDateStr}`, {}, token).catch(err => { console.error("Failed to fetch upcoming:", err); return []; }),
          apiCall("/equipment-records/overdue", {}, token).catch(err => { console.error("Failed to fetch overdue:", err); return []; })
        ];
        
        const [clientsData, typesData, equipmentsData, upcomingData, overdueData] = await Promise.all(fetchPromises);
        if (Array.isArray(clientsData)) {
          setClients(clientsData);
        }
        if (Array.isArray(typesData)) {
          setEquipmentTypes(typesData);
        }
        if (Array.isArray(equipmentsData)) {
          setAllEquipments(equipmentsData);
        }
        if (Array.isArray(upcomingData)) {
          setUpcoming(upcomingData);
        }
        if (Array.isArray(overdueData)) {
          setOverdue(overdueData);
        }
      } catch (fetchErr) {
        console.error("Error fetching initial data after login:", fetchErr);
        // Don't throw - login was successful, data will load via useEffect
      }
      return data;
    } catch (err) {
      setError(err.message || "Login failed");
      throw err;
    }
  }

  async function handleLogout() {
    try {
      if (authToken) {
        await apiCall("/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setAuthToken(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
      localStorage.removeItem("authToken");
      localStorage.removeItem("currentUser");
      setView("clients");
      // Refresh the page to clear all state and show login page
      window.location.reload();
    }
  }

  // API Functions
  async function apiCall(endpoint, options = {}, tokenOverride = null) {
    try {
      const headers = { "Content-Type": "application/json", ...options.headers };
      const tokenToUse = tokenOverride || authToken;
      if (tokenToUse) {
        headers["Authorization"] = `Bearer ${tokenToUse}`;
      }
      
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers,
        ...options,
      });
      
      // Handle 204 No Content (DELETE responses) before checking ok
      if (res.status === 204) {
        return null;
      }
      
      if (!res.ok) {
        // Handle 401 Unauthorized - token expired or invalid
        // Only logout if we have a token AND it's not during initial data fetch after login
        if (res.status === 401 && tokenToUse) {
          // Don't logout immediately after login (within 10 seconds) to prevent race conditions
          const timeSinceLogin = loginTime ? Date.now() - loginTime : Infinity;
          const isRecentlyLoggedIn = timeSinceLogin < 10000; // 10 seconds
          
          // Don't logout if:
          // 1. We're in the middle of login process
          // 2. It's an initial data fetch endpoint
          // 3. User just logged in (within 10 seconds)
          const isAuthEndpoint = endpoint.includes("/auth/");
          const isInitialDataLoad = endpoint.includes("/clients") || 
                                    endpoint.includes("/equipment-types") || 
                                    endpoint.includes("/equipment-records");
          
          if (!isAuthEndpoint && !isInitialDataLoad && !isRecentlyLoggedIn) {
            // Only logout for non-auth, non-initial-load endpoints, and not right after login
            handleLogout();
            throw new Error("Session expired. Please login again.");
          } else {
            // For auth endpoints, initial data fetch, or right after login, just throw error
            const text = await res.text();
            const errorMsg = text || `HTTP ${res.status}: ${res.statusText}`;
            console.warn("API call failed (not logging out):", endpoint, errorMsg);
            throw new Error(errorMsg);
          }
        }
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
      
      // Calculate end date from selected date + interval weeks
      const startDate = upcomingDate || new Date().toISOString().split('T')[0];
      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + (upcomingInterval * 7)); // Add interval weeks
      const endDate = end.toISOString().split('T')[0];
      
      url += `?start_date=${startDate}&end_date=${endDate}`;
      
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

  // Login Component
  if (!isAuthenticated) {
    return <LoginView onLogin={handleLogin} error={error} />;
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
        <nav className="tabs" style={{ marginTop: "0", display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
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
              Upcoming ({overdue.length + upcoming.length})
          </button>
            <button
              className={view === "completed" ? "active" : ""}
              onClick={() => setView("completed")}
            >
              Completed ({completions.length})
            </button>
            <button
              className={view === "user" ? "active" : ""}
              onClick={() => setView("user")}
            >
              User
            </button>
          </div>
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
            currentUser={currentUser}
            allEquipments={allEquipments}
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
            currentUser={currentUser}
            allEquipments={allEquipments}
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
            currentUser={currentUser}
            onRefreshCompletions={() => fetchCompletions(true)}
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
            upcomingDate={upcomingDate}
            setUpcomingDate={setUpcomingDate}
            upcomingInterval={upcomingInterval}
            setUpcomingInterval={setUpcomingInterval}
            currentUser={currentUser}
            overdue={overdue}
            setOverdue={setOverdue}
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
            currentUser={currentUser}
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

        {view === "completed" && (
          <CompletedView
            apiCall={apiCall}
            setError={setError}
            loading={loading}
            setLoading={setLoading}
            currentUser={currentUser}
            completions={completions}
            setCompletions={setCompletions}
            onRefresh={() => fetchCompletions()}
          />
        )}

        {view === "user" && (
          <UserView 
            apiCall={apiCall} 
            setError={setError} 
            currentUser={currentUser}
            onLogout={handleLogout}
          />
        )}

      </main>
    </div>
  );
}

export default App;
