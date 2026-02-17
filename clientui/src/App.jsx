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
import DeletedRecordsView from "./components/DeletedRecordsView";

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

  // Initialize view from URL hash or default to "clients"
  const getViewFromHash = () => {
    const hash = window.location.hash.slice(1); // Remove #
    const validViews = ["clients", "client-sites", "all-equipments", "upcoming", "overdue", "completed", "admin", "user", "add-equipment", "edit-client", "edit-site", "edit-contact", "deleted-records"];
    return validViews.includes(hash) ? hash : "clients";
  };

  const [view, setView] = useState(() => {
    // Check authToken directly since isAuthenticated might not be initialized yet
    const token = localStorage.getItem("authToken");
    if (!token) return "clients";
    return getViewFromHash();
  }); // "clients", "client-sites", "all-equipments", "upcoming", "overdue", "completed", "admin", "user", "add-equipment", "edit-client", "edit-site", "edit-contact"
  const [equipmentToEdit, setEquipmentToEdit] = useState(null); // Equipment record to edit when navigating to add-equipment page
  const [initialClientIdForEquipment, setInitialClientIdForEquipment] = useState(null); // Initial client ID when adding new equipment from filtered view
  const [initialSiteIdForEquipment, setInitialSiteIdForEquipment] = useState(null); // Initial site ID when adding new equipment from filtered view
  const [clientToEdit, setClientToEdit] = useState(null); // Client to edit when navigating to edit-client page
  const [siteToEdit, setSiteToEdit] = useState(null); // Site to edit when navigating to edit-site page
  const [contactToEdit, setContactToEdit] = useState(null); // Contact link to edit when navigating to edit-contact page
  const [contactContext, setContactContext] = useState(null); // { site, client } context for contact editing
  const [previousView, setPreviousView] = useState(null); // Track previous view to return to after add-equipment
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedSite, setSelectedSite] = useState(null);
  const [scrollToEquipmentId, setScrollToEquipmentId] = useState(null); // Equipment record ID to scroll to in all-equipments view
  const [allEquipmentsInitialClientId, setAllEquipmentsInitialClientId] = useState(null); // Initial client filter for all-equipments view
  const [allEquipmentsInitialSiteId, setAllEquipmentsInitialSiteId] = useState(null); // Initial site filter for all-equipments view
  const [upcomingInitialClientId, setUpcomingInitialClientId] = useState(null); // Initial client filter for upcoming view
  const [upcomingInitialSiteId, setUpcomingInitialSiteId] = useState(null); // Initial site filter for upcoming view
  const [upcomingFilterInfo, setUpcomingFilterInfo] = useState(null); // Filter info for upcoming view: { businessName, clientName, siteName, equipmentTypeName }
  const [dataLoaded, setDataLoaded] = useState(false); // Track if initial data has been loaded
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
  const [businesses, setBusinesses] = useState([]);
  const [upcomingDate, setUpcomingDate] = useState(() => {
    // Default to today's date
    return new Date().toISOString().split('T')[0];
  });
  const [upcomingInterval, setUpcomingInterval] = useState(2); // Default to 2 weeks

  // Sync view with URL hash and handle browser back/forward buttons
  useEffect(() => {
    if (!isAuthenticated) return;

    // Initialize URL hash if missing
    if (!window.location.hash) {
      window.history.replaceState({ view: "clients" }, "", "#clients");
      return;
    }

    // Update URL hash when view changes programmatically (not from popstate)
    const currentHash = window.location.hash.slice(1);
    if (currentHash !== view) {
      window.history.pushState({ view }, "", `#${view}`);
    }

    // Handle browser back/forward buttons
    const handlePopState = (event) => {
      const newView = getViewFromHash();
      if (newView !== view) {
        setView(newView);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [view, isAuthenticated]);

  useEffect(() => {
    // Only fetch if authenticated and data hasn't been loaded yet
    // Data is already loaded during login, so skip if already loaded
    if (isAuthenticated && authToken && !dataLoaded) {
      const isSuperAdmin = currentUser?.is_super_admin === true || currentUser?.is_super_admin === 1;
      
      // Fetch all data in parallel for faster loading
      Promise.all([
        fetchClients(),
        fetchEquipmentTypes(),
        fetchSites(null, true),
        fetchAllEquipments(true),
        fetchUpcoming(true),
        fetchOverdue(true),
        fetchCompletions(true),
        isSuperAdmin ? fetchBusinesses() : Promise.resolve()
      ]).then(() => {
        setDataLoaded(true);
      }).catch(err => {
        console.error("Error loading initial data:", err);
      });
    }
  }, [isAuthenticated, authToken, currentUser, dataLoaded]);

  // Fetch sites when a client is selected
  useEffect(() => {
    if (selectedClient) {
      // Always fetch fresh sites for the selected client
      fetchSites(selectedClient.id);
      fetchClientEquipments(selectedClient.id);
    }
  }, [selectedClient]);

  // Fetch all sites when viewing clients list (for counts)
  useEffect(() => {
    if (view === "clients" && !selectedClient) {
      fetchSites(null, true); // Fetch all sites silently for counts
    }
  }, [view, selectedClient]);

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

  // Fetch data when upcoming view is selected - only if date/interval changed
  // UpcomingView will use existing data if available
  useEffect(() => {
    if (view === "upcoming") {
      // Only fetch if we don't have data or if date/interval changed
      // UpcomingView will handle its own fetching with the new parameters
      // This prevents redundant fetches when just switching views
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
          apiCall("/equipment-records/overdue", {}, token).catch(err => { console.error("Failed to fetch overdue:", err); return []; }),
          // Fetch businesses if super admin
          data.user?.is_super_admin ? apiCall("/businesses", {}, token).catch(err => { console.error("Failed to fetch businesses:", err); return []; }) : Promise.resolve([])
        ];
        
        const [clientsData, typesData, equipmentsData, upcomingData, overdueData, businessesData] = await Promise.all(fetchPromises);
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
        if (Array.isArray(businessesData)) {
          setBusinesses(businessesData);
        }
        
        // Mark data as loaded to prevent redundant fetches
        setDataLoaded(true);
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

  async function handleLogout(skipApiCall = false) {
    try {
      // Skip API call if session is already expired or if explicitly requested
      if (!skipApiCall && authToken) {
        try {
          await apiCall("/auth/logout", {
            method: "POST",
            headers: { Authorization: `Bearer ${authToken}` },
          });
        } catch (err) {
          // If logout API call fails (e.g., session already expired), continue with local logout
          console.warn("Logout API call failed, proceeding with local logout:", err);
        }
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

  // Idle timeout: 30 minutes in milliseconds
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  // Track idle timeout - automatically log out after 30 minutes of inactivity
  useEffect(() => {
    if (!isAuthenticated || !authToken) return;

    let idleTimer = null;

    // Reset the idle timer
    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        // Session expired due to inactivity
        console.warn("Session expired due to inactivity (30 minutes). Logging out.");
        handleLogout(true); // Skip API call since we're logging out due to inactivity
      }, IDLE_TIMEOUT_MS);
    };

    // Track user activity events
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click', 'keydown'];
    
    const handleActivity = () => {
      resetIdleTimer();
    };

    // Add event listeners for user activity
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Initialize the timer
    resetIdleTimer();

    // Cleanup
    return () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [isAuthenticated, authToken]);

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
        if (res.status === 401 && tokenToUse) {
          // Don't logout if this is the login endpoint itself (invalid credentials)
          const isLoginEndpoint = endpoint.includes("/auth/login");
          
          if (!isLoginEndpoint) {
            // Session expired - automatically log out (skip API call to avoid another 401)
            console.warn("Session expired. Logging out automatically.");
            handleLogout(true); // Skip API call since session is already expired
            throw new Error("Session expired. Please login again.");
          }
        }
        const text = await res.text();
        let errorMsg;
        try {
          const json = JSON.parse(text);
          errorMsg = json.detail || json.message || text || `HTTP ${res.status}: ${res.statusText}`;
        } catch {
          errorMsg = text || `HTTP ${res.status}: ${res.statusText}`;
        }
        // Ensure we always throw a string message, not an object
        if (typeof errorMsg !== "string") {
          try {
            errorMsg = JSON.stringify(errorMsg);
          } catch {
            errorMsg = `HTTP ${res.status}: ${res.statusText}`;
          }
        }
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
      // Provide more user-friendly error messages
      let errorMessage = err && typeof err.message !== "undefined" ? err.message : String(err);
      if (err.message === "Failed to fetch" || err.message.includes("NetworkError") || err.message.includes("fetch")) {
        errorMessage = "Unable to connect to the server. Please check if the backend is running and try again.";
      }
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }

  async function fetchClients(businessIdFilter = null) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const isSuperAdmin = currentUser?.is_super_admin === true || currentUser?.is_super_admin === 1;
      if (isSuperAdmin && businessIdFilter) {
        params.append("business_id_filter", businessIdFilter.toString());
      }
      const endpoint = `/clients${params.toString() ? `?${params.toString()}` : ""}`;
      const data = await apiCall(endpoint);
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

  async function fetchSites(clientId = null, silent = false, force = false) {
    const validClientId = clientId && typeof clientId === 'number' ? clientId : 
                         (clientId && !isNaN(parseInt(clientId)) ? parseInt(clientId) : null);
    
    if (!silent) setLoading(true);
    try {
      const endpoint = validClientId ? `/sites?client_id=${validClientId}` : "/sites";
      const data = await apiCall(endpoint);
      setSites(data || []);
    } catch (err) {
      // error already set
      setSites([]);
    } finally {
      if (!silent) setLoading(false);
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

  async function fetchBusinesses() {
    try {
      const data = await apiCall("/businesses");
      setBusinesses(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching businesses:", err);
      setBusinesses([]);
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

  // Refresh all counts silently after database changes
  async function refreshAllCounts() {
    try {
      // Always refresh to ensure counts are accurate
      await Promise.all([
        fetchClients().catch(() => {}),
        fetchSites(null, true).catch(() => {}),
        fetchAllEquipments(true).catch(() => {}),
        fetchUpcoming(true).catch(() => {}),
        fetchOverdue(true).catch(() => {}),
        fetchCompletions(true).catch(() => {})
      ]);
    } catch (err) {
      // Silently fail - counts will update on next manual refresh
      console.error("Error refreshing counts:", err);
    }
  }

  async function handleBusinessSwitch(businessId) {
    try {
      // Refresh current user info to get updated business_id
      const userInfo = await apiCall("/auth/me");
      setCurrentUser(userInfo);
      localStorage.setItem("currentUser", JSON.stringify(userInfo));
      
      // Refresh all data for the new business context (or all businesses if businessId is null)
      await refreshAllCounts();
      setView("clients"); // Switch to clients view
    } catch (err) {
      setError("Failed to switch business context");
      console.error("Error switching business:", err);
    }
  }

  const isSuperAdmin = currentUser?.is_super_admin === true || currentUser?.is_super_admin === 1;

  // Login Component
  if (!isAuthenticated) {
    return <LoginView onLogin={handleLogin} error={error} />;
  }

  // Get current business name
  const currentBusiness = businesses.find(b => b.id === currentUser?.business_id);
  let businessName = currentBusiness?.name;

  // Get context names based on current view
  const getContextNames = () => {
    const names = [];
    
    // Determine business name - if in "all businesses" mode and a client is selected, get business from client
    let displayBusinessName = businessName;
    if (!displayBusinessName && selectedClient && selectedClient.business_id) {
      // In "all businesses" mode, get business name from selected client
      const clientBusiness = businesses.find(b => b.id === selectedClient.business_id);
      displayBusinessName = clientBusiness?.name;
    }
    
    // Always show business name if available (except when on clients page - show only business)
    if (displayBusinessName) {
      names.push(displayBusinessName);
    }
    
    // Show client name when:
    // - Editing a client
    // - On sites page (client-sites view)
    // - When a client is selected and we're on equipment views
    if (view === "edit-client" && clientToEdit) {
      names.push(clientToEdit.name);
    } else if (view === "client-sites" && selectedClient) {
      names.push(selectedClient.name);
    } else if (view === "clients") {
      // On clients page, show only business name (already added above)
      // Don't add client name
    } else if (selectedClient && (view === "all-equipments" || view === "upcoming" || view === "completed")) {
      // For equipment views, show client if selected
      names.push(selectedClient.name);
    }
    
    // Show site name when:
    // - Editing a site
    // - On sites page (client-sites view) when a site is selected
    // - When a site is selected and we're on equipment views
    if (view === "edit-site" && siteToEdit) {
      names.push(siteToEdit.name);
    } else if (view === "client-sites" && selectedSite) {
      // Show site name when on client-sites view and a site is selected
      names.push(selectedSite.name);
    } else if (selectedSite && (view === "all-equipments" || view === "upcoming" || view === "completed")) {
      // For equipment views, show site if selected
      names.push(selectedSite.name);
    }
    
    // For upcoming view, show filter information if available
    if (view === "upcoming" && upcomingFilterInfo) {
      const filterNames = [];
      if (upcomingFilterInfo.businessName) {
        filterNames.push(upcomingFilterInfo.businessName);
      }
      if (upcomingFilterInfo.clientName) {
        filterNames.push(upcomingFilterInfo.clientName);
      }
      if (upcomingFilterInfo.siteName) {
        filterNames.push(upcomingFilterInfo.siteName);
      }
      if (upcomingFilterInfo.equipmentTypeName) {
        filterNames.push(upcomingFilterInfo.equipmentTypeName);
      }
      // Replace the context names with filter names if filters are applied
      if (filterNames.length > 0) {
        return filterNames;
      }
    }
    
    return names;
  };

  const contextNames = getContextNames();

  return (
    <div className="app">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <img 
            src={wavePhysicsLogo} 
            alt="WAVE PHYSICS" 
            className="logo"
            style={{ height: "50px", maxWidth: "200px", objectFit: "contain" }}
          />
          {contextNames.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#D7E5D8", fontSize: "0.95rem" }}>
              {contextNames.map((name, index) => (
                <span key={index}>
                  {index > 0 && <span style={{ margin: "0 0.25rem" }}>•</span>}
                  <span style={{ fontWeight: index === 0 ? "600" : "400" }}>{name}</span>
                </span>
              ))}
        </div>
          )}
        </div>
        <nav className="tabs" style={{ marginTop: "0", display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className={view === "clients" ? "active" : ""}
            onClick={() => {
              setView("clients");
              setSelectedClient(null);
              setSelectedSite(null);
              setUpcomingFilterInfo(null);
            }}
          >
              Clients ({clients.length})
          </button>
          {/* Temporarily hidden - All Equipments tab
          <button
            className={view === "all-equipments" ? "active" : ""}
                onClick={() => {
              // Clear filters when navigating from navigation bar
              setAllEquipmentsInitialClientId(null);
              setAllEquipmentsInitialSiteId(null);
              setView("all-equipments");
            }}
          >
              All Equipments ({allEquipments.length})
          </button>
          */}
          <button
              className={view === "upcoming" ? "active" : ""}
              onClick={() => {
                setView("upcoming");
                // Clear filter info when navigating to upcoming (will be set by UpcomingView if filters are applied)
                setUpcomingFilterInfo(null);
              }}
          >
              Upcoming ({overdue.length + upcoming.length})
          </button>
          <button
              className={view === "completed" ? "active" : ""}
              onClick={() => {
                setView("completed");
                setUpcomingFilterInfo(null);
              }}
          >
              Completed ({completions.length})
          </button>
            {isSuperAdmin && (
          <button
                className={view === "deleted-records" ? "active" : ""}
                onClick={() => setView("deleted-records")}
          >
                Deleted Records
          </button>
            )}
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
              // Clicking on client shows its sites
              setSelectedClient(client);
              setView("client-sites");
            }}
            businesses={businesses}
            isSuperAdmin={isSuperAdmin}
            onEditClient={(client) => {
              // Edit button opens edit client page
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
            sites={sites}
            onRefreshAllCounts={refreshAllCounts}
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
              await refreshAllCounts(); // Refresh all counts after client change
            }}
          />
        )}

        {view === "client-sites" && selectedClient && (
          <ClientSitesView
            client={selectedClient}
            sites={sites}
            clientEquipments={clientEquipments}
            onRefreshSites={async () => {
              await fetchSites(selectedClient.id);
              await refreshAllCounts(); // Refresh all counts after site refresh
            }}
            onRefreshAllCounts={refreshAllCounts}
            onRefreshEquipments={() => fetchClientEquipments(selectedClient.id)}
            onSiteClick={(site) => {
              // Navigate to upcoming view with client and site filters applied
              setUpcomingInitialClientId(selectedClient.id.toString());
              setUpcomingInitialSiteId(site.id.toString());
              // Set selected site for context display
              setSelectedSite(site);
              setView("upcoming");
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
              await refreshAllCounts(); // Refresh all counts after site change
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
            initialClientId={allEquipmentsInitialClientId}
            initialSiteId={allEquipmentsInitialSiteId}
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
            initialClientId={upcomingInitialClientId}
            initialSiteId={upcomingInitialSiteId}
            onBack={() => {
              if (selectedClient) {
                // Return to client sites page
                setView("client-sites");
              } else {
                // Return to clients list
                setView("clients");
                setSelectedClient(null);
              }
            }}
            onNavigateToAddEquipment={(equipment) => {
              setEquipmentToEdit(equipment);
              // If equipment is an object with client_id/site_id (from filters), set initial values
              if (equipment && typeof equipment === 'object' && !equipment.id) {
                setInitialClientIdForEquipment(equipment.client_id || null);
                setInitialSiteIdForEquipment(equipment.site_id || null);
              } else {
                setInitialClientIdForEquipment(null);
                setInitialSiteIdForEquipment(null);
              }
              setPreviousView("upcoming");
              setView("add-equipment");
            }}
            onRefreshCompletions={() => fetchCompletions(true)}
            onRefreshAllCounts={refreshAllCounts}
            onFilterChange={(filterInfo) => {
              setUpcomingFilterInfo(filterInfo);
            }}
            businesses={businesses}
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
            initialClientId={initialClientIdForEquipment}
            initialSiteId={initialSiteIdForEquipment}
            isSuperAdmin={isSuperAdmin}
            onNavigateToBusinesses={() => {
              setEquipmentToEdit(null);
              setInitialClientIdForEquipment(null);
              setInitialSiteIdForEquipment(null);
              setPreviousView("add-equipment");
              setView("admin");
            }}
            onBack={() => {
              const returnView = previousView || "all-equipments";
              setEquipmentToEdit(null);
              setInitialClientIdForEquipment(null);
              setInitialSiteIdForEquipment(null);
              setPreviousView(null);
              setView(returnView);
            }}
            onSuccess={async () => {
              const returnView = previousView || "all-equipments";
              setEquipmentToEdit(null);
              setInitialClientIdForEquipment(null);
              setInitialSiteIdForEquipment(null);
              setPreviousView(null);
              setView(returnView);
              // Refresh data if coming from edit-site
              if (returnView === "edit-site" && siteToEdit) {
                await fetchSiteContacts(siteToEdit.id);
              }
              await refreshAllCounts(); // Refresh all counts after equipment change
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

        {view === "deleted-records" && isSuperAdmin && (
          <DeletedRecordsView
            apiCall={apiCall}
            currentUser={currentUser}
            businesses={businesses}
            onRefresh={refreshAllCounts}
          />
        )}

        {(view === "user" || view === "admin") && (
          <UserView 
            apiCall={apiCall} 
            setError={setError} 
            currentUser={currentUser}
            onLogout={handleLogout}
            isSuperAdmin={isSuperAdmin}
            authToken={authToken}
            onBusinessSwitch={handleBusinessSwitch}
            onRefresh={refreshAllCounts}
            initialTab={view === "admin" ? "admin" : "settings"}
          />
        )}

      </main>
    </div>
  );
}

export default App;
