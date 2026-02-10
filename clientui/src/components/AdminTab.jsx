import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../config";
import { formatDate } from "../utils/formatDate";

export default function AdminTab({ apiCall, setError, currentUser, isSuperAdmin, authToken, onBusinessSwitch, onRefresh }) {
  const [adminTab, setAdminTab] = useState("utilities");
  const [users, setUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", is_admin: false, business_id: null });
  const [businesses, setBusinesses] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingTemporary, setUploadingTemporary] = useState(false);
  const fileInputRef = useRef(null);
  const temporaryFileInputRef = useRef(null);
  
  // Business management state
  const [showAddBusiness, setShowAddBusiness] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState(null);
  const [businessName, setBusinessName] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState(null);
  const [createAdminUser, setCreateAdminUser] = useState(true);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [selectedBusinessForImport, setSelectedBusinessForImport] = useState(null);

  // Equipment type management state
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [showAddEquipmentType, setShowAddEquipmentType] = useState(false);
  const [editingEquipmentType, setEditingEquipmentType] = useState(null);
  const [equipmentTypesExpanded, setEquipmentTypesExpanded] = useState(true);
  const [equipmentTypeForm, setEquipmentTypeForm] = useState({
    name: "",
    interval_weeks: "52",
    rrule: "FREQ=WEEKLY;INTERVAL=52",
    default_lead_weeks: "4",
    active: true,
    business_id: null
  });

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
      // Add business_id if super admin and business is selected
      if (isSuperAdmin && selectedBusinessForImport) {
        formData.append('business_id', selectedBusinessForImport.toString());
      }

      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE}/admin/import/equipments`, {
        method: 'POST',
        headers,
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
      
      // Refresh all data after successful import
      if (onRefresh) {
        onRefresh();
      }
      await fetchEquipmentTypes();
      if (isSuperAdmin) {
        await fetchBusinesses();
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
      // Add business_id if super admin and business is selected
      if (isSuperAdmin && selectedBusinessForImport) {
        formData.append('business_id', selectedBusinessForImport.toString());
      }

      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(`${API_BASE}/admin/import/temporary`, {
        method: 'POST',
        headers,
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
      
      // Refresh all data after successful import
      if (onRefresh) {
        onRefresh();
      }
      await fetchEquipmentTypes();
      if (isSuperAdmin) {
        await fetchBusinesses();
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

  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [selectedUserForPasswordChange, setSelectedUserForPasswordChange] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function fetchUsers() {
    setLoadingUsers(true);
    try {
      const data = await apiCall("/users");
      setUsers(data || []);
    } catch (err) {
      setError(err.message || "Failed to fetch users");
    } finally {
      setLoadingUsers(false);
    }
  }

  async function fetchBusinesses() {
    if (!isSuperAdmin) return;
    try {
      const data = await apiCall("/businesses");
      setBusinesses(data || []);
      // Set selectedBusinessId based on current user's business_id (can be null/undefined for "all businesses")
      setSelectedBusinessId(currentUser?.business_id ?? null);
    } catch (err) {
      console.error("Failed to fetch businesses:", err);
    }
  }

  async function fetchEquipmentTypes() {
    try {
      const types = await apiCall("/equipment-types");
      setEquipmentTypes(types || []);
    } catch (err) {
      console.error("Failed to fetch equipment types:", err);
      setEquipmentTypes([]);
    }
  }

  useEffect(() => {
    if (adminTab === "users" && currentUser?.is_admin) {
      fetchUsers();
      if (isSuperAdmin) {
        fetchBusinesses();
      }
    }
    if (adminTab === "businesses" && isSuperAdmin) {
      fetchBusinesses();
    }
    if (adminTab === "utilities" && currentUser?.is_admin) {
      fetchEquipmentTypes();
      if (isSuperAdmin) {
        fetchBusinesses();
      }
    }
  }, [adminTab, currentUser, isSuperAdmin]);

  async function handleCreateUser() {
    if (!newUser.username || !newUser.password) {
      setError("Username and password are required");
      return;
    }
    try {
      await apiCall("/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setNewUser({ username: "", password: "", is_admin: false, business_id: null });
      setShowAddUser(false);
      await fetchUsers();
    } catch (err) {
      setError(err.message || "Failed to create user");
    }
  }

  async function handleDeleteUser(userId) {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    try {
      await apiCall(`/users/${userId}`, { method: "DELETE" });
      await fetchUsers();
    } catch (err) {
      setError(err.message || "Failed to delete user");
    }
  }

  function handleChangePasswordClick(user) {
    setSelectedUserForPasswordChange(user);
    setNewPassword("");
    setConfirmPassword("");
    setShowChangePasswordModal(true);
  }

  function handleCancelPasswordChange() {
    setShowChangePasswordModal(false);
    setSelectedUserForPasswordChange(null);
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleSavePasswordChange() {
    if (!newPassword || newPassword.length < 1) {
      setError("Password cannot be empty");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    try {
      await apiCall("/admin/change-password", {
        method: "PUT",
        body: JSON.stringify({
          user_id: selectedUserForPasswordChange.id,
          new_password: newPassword
        })
      });
      setShowChangePasswordModal(false);
      setSelectedUserForPasswordChange(null);
      setNewPassword("");
      setConfirmPassword("");
      alert("Password changed successfully");
    } catch (err) {
      setError(err.message || "Failed to change password");
    }
  }

  // Business management functions
  async function handleCreateBusiness() {
    if (!businessName.trim()) {
      setError("Business name is required");
      return;
    }
    if (createAdminUser) {
      if (!adminUsername.trim() || !adminPassword.trim()) {
        setError("Admin username and password are required when creating admin user");
        return;
      }
    }
    try {
      const payload = {
        name: businessName.trim(),
        create_admin_user: createAdminUser,
        admin_username: createAdminUser ? adminUsername.trim() : null,
        admin_password: createAdminUser ? adminPassword.trim() : null
      };
      await apiCall("/businesses", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setBusinessName("");
      setAdminUsername("");
      setAdminPassword("");
      setCreateAdminUser(true);
      setShowAddBusiness(false);
      await fetchBusinesses();
      if (onRefresh) onRefresh();
    } catch (err) {
      // error already set
    }
  }

  async function handleUpdateBusiness() {
    if (!businessName.trim() || !editingBusiness) {
      setError("Business name is required");
      return;
    }
    try {
      await apiCall(`/businesses/${editingBusiness.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: businessName.trim() })
      });
      setEditingBusiness(null);
      setBusinessName("");
      setShowAddBusiness(false);
      await fetchBusinesses();
      if (onRefresh) onRefresh();
    } catch (err) {
      // error already set
    }
  }

  async function handleDeleteBusiness(businessId) {
    try {
      // Fetch deletion summary first
      const summary = await apiCall(`/businesses/${businessId}/deletion-summary`);
      
      // Build confirmation message with all counts
      const counts = summary.counts;
      const items = [];
      
      if (counts.customers > 0) items.push(`${counts.customers} Customer${counts.customers !== 1 ? 's' : ''}`);
      if (counts.sites > 0) items.push(`${counts.sites} Site${counts.sites !== 1 ? 's' : ''}`);
      if (counts.contacts > 0) items.push(`${counts.contacts} Contact Link${counts.contacts !== 1 ? 's' : ''}`);
      if (counts.equipment > 0) items.push(`${counts.equipment} Equipment Record${counts.equipment !== 1 ? 's' : ''}`);
      if (counts.equipment_types > 0) items.push(`${counts.equipment_types} Equipment Type${counts.equipment_types !== 1 ? 's' : ''}`);
      if (counts.equipment_completions > 0) items.push(`${counts.equipment_completions} Equipment Completion${counts.equipment_completions !== 1 ? 's' : ''}`);
      if (counts.client_equipments > 0) items.push(`${counts.client_equipments} Client Equipment${counts.client_equipments !== 1 ? 's' : ''}`);
      if (counts.notes > 0) items.push(`${counts.notes} Note${counts.notes !== 1 ? 's' : ''}`);
      if (counts.attachments > 0) items.push(`${counts.attachments} Attachment${counts.attachments !== 1 ? 's' : ''}`);
      if (counts.users > 0) items.push(`${counts.users} User${counts.users !== 1 ? 's' : ''} (will be unlinked from business)`);
      
      const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
      
      let message = `Are you sure you want to delete "${summary.business_name}"?\n\n`;
      message += `This will permanently delete:\n`;
      if (items.length > 0) {
        items.forEach(item => {
          message += `• ${item}\n`;
        });
      } else {
        message += `• No associated data found\n`;
      }
      message += `\nTotal: ${totalCount} item${totalCount !== 1 ? 's' : ''} will be deleted.\n\n`;
      message += `This action cannot be undone.`;
      
      if (!window.confirm(message)) return;
      
      await apiCall(`/businesses/${businessId}`, { method: "DELETE" });
      await fetchBusinesses();
      if (onRefresh) onRefresh();
    } catch (err) {
      // error already set
    }
  }

  async function handleSwitchBusiness(businessId) {
    try {
      await apiCall("/auth/switch-business", {
        method: "POST",
        body: JSON.stringify({ business_id: businessId })
      });
      setSelectedBusinessId(businessId);
      // Wait a moment for the database update to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      if (onBusinessSwitch) {
        await onBusinessSwitch(businessId);
      }
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      // error already set
    }
  }

  async function handleSwitchToAllBusinesses() {
    await handleSwitchBusiness(null);
  }

  function handleEditBusiness(business) {
    setEditingBusiness(business);
    setBusinessName(business.name);
    setCreateAdminUser(false); // Don't create admin when editing
    setAdminUsername("");
    setAdminPassword("");
    setShowAddBusiness(true);
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
        {currentUser?.is_admin && (
          <button
            className={adminTab === "users" ? "active" : ""}
            onClick={() => setAdminTab("users")}
          >
            Users
          </button>
        )}
        {isSuperAdmin && (
          <button
            className={adminTab === "businesses" ? "active" : ""}
            onClick={() => setAdminTab("businesses")}
          >
            Businesses
          </button>
        )}
      </nav>

      {adminTab === "utilities" && (
        <>
          {/* Equipment Types Management - Separate Card */}
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div 
              className="card-header" 
              style={{ cursor: "pointer" }} 
              onClick={() => setEquipmentTypesExpanded(!equipmentTypesExpanded)}
            >
              <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ 
                  transform: equipmentTypesExpanded ? "rotate(90deg)" : "rotate(0deg)", 
                  transition: "transform 0.2s", 
                  display: "inline-block",
                  fontSize: "0.75rem"
                }}>▶</span>
                Equipment Types
                <span style={{ fontSize: "0.875rem", fontWeight: "normal", color: "#8193A4", marginLeft: "0.5rem" }}>
                  ({equipmentTypes.length})
                </span>
              </h2>
              <div style={{ display: "flex", gap: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                {isSuperAdmin && selectedBusinessId && (
                  <button 
                    className="secondary" 
                    onClick={async () => {
                      await handleSwitchBusiness(null);
                      await fetchEquipmentTypes();
                    }}
                  >
                    View All Businesses
                  </button>
                )}
                <button className="secondary" onClick={fetchEquipmentTypes}>Refresh</button>
              </div>
            </div>
            
            {equipmentTypesExpanded && (
              <div style={{ padding: "1rem" }}>
                <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                  Manage equipment types for {isSuperAdmin ? "businesses" : "your business"}. Each business has its own equipment types.
                  {isSuperAdmin && " As superadmin, you can create equipment types for any business or for all businesses."}
                </p>

                {isSuperAdmin && selectedBusinessId === null && (
                  <div style={{ padding: "1rem", marginBottom: "1.5rem", backgroundColor: "rgba(129, 147, 164, 0.1)", borderLeft: "4px solid #8193A4", borderRadius: "0.25rem" }}>
                    <strong>Viewing All Businesses</strong> - You are currently viewing equipment types from all businesses. Switch to a specific business to filter.
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
                  <button
                    className="primary"
                    onClick={() => {
                      setEditingEquipmentType(null);
                      setEquipmentTypeForm({
                        name: "",
                        interval_weeks: "52",
                        rrule: "FREQ=WEEKLY;INTERVAL=52",
                        default_lead_weeks: "4",
                        active: true,
                        business_id: isSuperAdmin ? null : currentUser?.business_id
                      });
                      setShowAddEquipmentType(true);
                    }}
                  >
                    + Add New Equipment Type
                  </button>
                </div>

                {equipmentTypes.length === 0 ? (
                  <p className="empty">No equipment types yet. Click "Add New Equipment Type" to get started.</p>
                ) : (
                  <div style={{ maxHeight: "500px", overflowY: "auto", border: "1px solid #e0e0e0", borderRadius: "0.25rem", padding: "0.5rem" }}>
                    <ul className="list" style={{ margin: 0 }}>
                      {equipmentTypes.map(type => (
                        <li key={type.id} className="list-item">
                          <div className="list-main" style={{ flex: 1 }}>
                            <div className="list-title">
                              {type.name}
                              {!type.active && (
                                <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#8193A4", fontStyle: "italic" }}>
                                  (Inactive)
                                </span>
                              )}
                            </div>
                            <div className="list-subtitle">
                              {type.business_name && `Business: ${type.business_name} • `}
                              Interval: {type.interval_weeks} weeks • Default Lead: {type.default_lead_weeks} weeks
                            </div>
                          </div>
                          <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => {
                              setEditingEquipmentType(type);
                              setEquipmentTypeForm({
                                name: type.name,
                                interval_weeks: type.interval_weeks.toString(),
                                rrule: type.rrule,
                                default_lead_weeks: type.default_lead_weeks.toString(),
                                active: type.active,
                                business_id: null // Don't allow changing business when editing
                              });
                              setShowAddEquipmentType(true);
                            }}>Edit</button>
                            <button className="danger" onClick={async () => {
                              if (!window.confirm(`Are you sure you want to delete "${type.name}"?`)) return;
                              try {
                                await apiCall(`/equipment-types/${type.id}`, { method: "DELETE" });
                                await fetchEquipmentTypes();
                                if (onRefresh) onRefresh();
                              } catch (err) {
                                setError(err.message || "Failed to delete equipment type");
                              }
                            }}>Delete</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Import/Export Section - Separate Card */}
          <div className="card">
            <div className="card-header">
              <h2>Import & Export</h2>
            </div>
            
            <div style={{ padding: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem" }}>
              {/* Import Section */}
              <div style={{ 
                padding: "1.5rem", 
                backgroundColor: "#f8f9fa", 
                borderRadius: "0.5rem",
                border: "1px solid #e0e0e0"
              }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234" }}>Import Equipments</h3>
                <p style={{ color: "#8193A4", fontSize: "0.875rem", marginBottom: "1rem", lineHeight: "1.5" }}>
                  Import equipment records from Excel file. Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date.
                  {isSuperAdmin && " Optional column: Business."}
                </p>
                <div style={{ 
                  padding: "0.75rem", 
                  backgroundColor: "#fff3cd", 
                  borderRadius: "0.25rem", 
                  marginBottom: "1rem",
                  fontSize: "0.875rem",
                  color: "#856404"
                }}>
                  <strong>Note:</strong> If client or site doesn't exist, the row will be skipped.
                </div>
                {isSuperAdmin && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: "600", color: "#2D3234" }}>
                      Business (Optional)
                    </label>
                    <select
                      value={selectedBusinessForImport || ""}
                      onChange={(e) => setSelectedBusinessForImport(e.target.value ? parseInt(e.target.value) : null)}
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        border: "1px solid #8193A4",
                        borderRadius: "0.25rem",
                        fontSize: "0.875rem"
                      }}
                    >
                      <option value="">Use Business column from Excel</option>
                      {businesses.map(business => (
                        <option key={business.id} value={business.id.toString()}>
                          {business.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
                  style={{ 
                    cursor: (uploading || uploadingTemporary) ? "not-allowed" : "pointer",
                    width: "100%"
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? "Uploading..." : "📁 Import Equipments"}
                </button>
              </div>

              {/* Temporary Upload Section */}
              <div style={{ 
                padding: "1.5rem", 
                backgroundColor: "#f8f9fa", 
                borderRadius: "0.5rem",
                border: "1px solid #e0e0e0"
              }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234" }}>Temporary Data Upload</h3>
                <p style={{ color: "#8193A4", fontSize: "0.875rem", marginBottom: "1rem", lineHeight: "1.5" }}>
                  Import equipment records from Excel file. Creates missing clients, sites, and businesses automatically.
                </p>
                <div style={{ 
                  padding: "0.75rem", 
                  backgroundColor: "#d1ecf1", 
                  borderRadius: "0.25rem", 
                  marginBottom: "1rem",
                  fontSize: "0.875rem",
                  color: "#0c5460"
                }}>
                  <strong>Auto-Create:</strong> Missing clients, sites{businesses.length > 0 && ", and businesses"} will be created automatically.
                </div>
                {isSuperAdmin && (
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: "600", color: "#2D3234" }}>
                      Business (Optional)
                    </label>
                    <select
                      value={selectedBusinessForImport || ""}
                      onChange={(e) => setSelectedBusinessForImport(e.target.value ? parseInt(e.target.value) : null)}
                      style={{
                        width: "100%",
                        padding: "0.5rem",
                        border: "1px solid #8193A4",
                        borderRadius: "0.25rem",
                        fontSize: "0.875rem"
                      }}
                    >
                      <option value="">Use Business column from Excel</option>
                      {businesses.map(business => (
                        <option key={business.id} value={business.id.toString()}>
                          {business.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
                  style={{ 
                    cursor: (uploading || uploadingTemporary) ? "not-allowed" : "pointer",
                    width: "100%"
                  }}
                  onClick={() => temporaryFileInputRef.current?.click()}
                >
                  {uploadingTemporary ? "Uploading..." : "📁 Temporary Data Upload"}
                </button>
              </div>

              {/* Export Section */}
              <div style={{ 
                padding: "1.5rem", 
                backgroundColor: "#f8f9fa", 
                borderRadius: "0.5rem",
                border: "1px solid #e0e0e0"
              }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.75rem", color: "#2D3234" }}>Export Equipments</h3>
                <p style={{ color: "#8193A4", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: "1.5" }}>
                  Export all equipment records to an Excel file for backup or external processing.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={handleExportEquipments}
                  style={{ width: "100%" }}
                >
                  📥 Export Equipments
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {showAddEquipmentType && (
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
        }} onClick={() => {
          setShowAddEquipmentType(false);
          setEditingEquipmentType(null);
          setEquipmentTypeForm({
            name: "",
            interval_weeks: "52",
            rrule: "FREQ=WEEKLY;INTERVAL=52",
            default_lead_weeks: "4",
            active: true,
            business_id: null
          });
        }}>
          <div style={{
            backgroundColor: "#D7E5D8",
            padding: "2rem",
            borderRadius: "0.5rem",
            maxWidth: "500px",
            width: "90%",
            color: "#2D3234",
            maxHeight: "90vh",
            overflowY: "auto"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ margin: 0, color: "#2D3234" }}>
                {editingEquipmentType ? "Edit Equipment Type" : "Add New Equipment Type"}
              </h2>
              <button onClick={() => {
                setShowAddEquipmentType(false);
                setEditingEquipmentType(null);
                setEquipmentTypeForm({
                  name: "",
                  interval_weeks: "52",
                  rrule: "FREQ=WEEKLY;INTERVAL=52",
                  default_lead_weeks: "4",
                  active: true,
                  business_id: null
                });
              }} style={{ color: "#2D3234", border: "1px solid #8193A4", background: "transparent", cursor: "pointer", fontSize: "1.5rem", padding: "0.25rem 0.5rem" }}>✕</button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {isSuperAdmin && !editingEquipmentType && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "600", color: "#2D3234" }}>
                    Business
                  </label>
                  <select
                    value={equipmentTypeForm.business_id === null ? "all" : (equipmentTypeForm.business_id || "")}
                    onChange={(e) => {
                      const value = e.target.value;
                      setEquipmentTypeForm(prev => ({ 
                        ...prev, 
                        business_id: value === "all" ? null : (value ? parseInt(value) : null)
                      }));
                    }}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid #8193A4",
                      borderRadius: "0.25rem",
                      backgroundColor: "#fff",
                      color: "#2D3234"
                    }}
                  >
                    <option value="all">All Businesses</option>
                    {businesses.map(business => (
                      <option key={business.id} value={business.id.toString()}>
                        {business.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "600", color: "#2D3234" }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={equipmentTypeForm.name}
                  onChange={(e) => setEquipmentTypeForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Equipment type name"
                  required
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
                  Interval (weeks) *
                </label>
                <input
                  type="number"
                  value={equipmentTypeForm.interval_weeks}
                  onChange={(e) => {
                    const interval = e.target.value;
                    setEquipmentTypeForm(prev => ({
                      ...prev,
                      interval_weeks: interval,
                      rrule: `FREQ=WEEKLY;INTERVAL=${interval || 52}`
                    }));
                  }}
                  required
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
                  Default Lead Weeks *
                </label>
                <input
                  type="number"
                  value={equipmentTypeForm.default_lead_weeks}
                  onChange={(e) => setEquipmentTypeForm(prev => ({ ...prev, default_lead_weeks: e.target.value }))}
                  required
                  min="0"
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

              <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
                <div
                  onClick={() => setEquipmentTypeForm(prev => ({ ...prev, active: !prev.active }))}
                  style={{
                    position: "relative",
                    width: "48px",
                    height: "24px",
                    backgroundColor: equipmentTypeForm.active ? "#8193A4" : "#cbd5e1",
                    borderRadius: "12px",
                    transition: "background-color 0.2s ease",
                    cursor: "pointer",
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "2px",
                      left: equipmentTypeForm.active ? "26px" : "2px",
                      width: "20px",
                      height: "20px",
                      backgroundColor: "#ffffff",
                      borderRadius: "50%",
                      transition: "left 0.2s ease",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)"
                    }}
                  />
                </div>
                <span style={{ userSelect: "none" }}>Active</span>
              </label>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button 
                  className="primary" 
                  onClick={async () => {
                    if (!equipmentTypeForm.name.trim()) {
                      setError("Equipment type name is required");
                      return;
                    }
                    try {
                      const payload = {
                        name: equipmentTypeForm.name.trim(),
                        interval_weeks: parseInt(equipmentTypeForm.interval_weeks) || 52,
                        rrule: equipmentTypeForm.rrule || `FREQ=WEEKLY;INTERVAL=${parseInt(equipmentTypeForm.interval_weeks) || 52}`,
                        default_lead_weeks: parseInt(equipmentTypeForm.default_lead_weeks) || 4,
                        active: equipmentTypeForm.active
                      };
                      // Include business_id (can be null for "all businesses")
                      if (isSuperAdmin && !editingEquipmentType) {
                        payload.business_id = equipmentTypeForm.business_id;
                      }
                      if (editingEquipmentType) {
                        await apiCall(`/equipment-types/${editingEquipmentType.id}`, {
                          method: "PUT",
                          body: JSON.stringify(payload)
                        });
                      } else {
                        await apiCall("/equipment-types", {
                          method: "POST",
                          body: JSON.stringify(payload)
                        });
                      }
                      setShowAddEquipmentType(false);
                      setEditingEquipmentType(null);
                      setEquipmentTypeForm({
                        name: "",
                        interval_weeks: "52",
                        rrule: "FREQ=WEEKLY;INTERVAL=52",
                        default_lead_weeks: "4",
                        active: true,
                        business_id: null
                      });
                      await fetchEquipmentTypes();
                      if (onRefresh) onRefresh();
                    } catch (err) {
                      // error already set
                    }
                  }}
                >
                  {editingEquipmentType ? "Update" : "Create"}
                </button>
                <button 
                  className="secondary"
                  onClick={() => {
                    setShowAddEquipmentType(false);
                    setEditingEquipmentType(null);
                    setEquipmentTypeForm({
                      name: "",
                      interval_weeks: "52",
                      rrule: "FREQ=WEEKLY;INTERVAL=52",
                      default_lead_weeks: "4",
                      active: true,
                      business_id: null
                    });
                  }}
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

      {adminTab === "users" && currentUser?.is_admin && (
        <div className="card">
          <div className="card-header">
            <h2>User Management</h2>
            <button
              className="primary"
              onClick={() => setShowAddUser(!showAddUser)}
            >
              {showAddUser ? "Cancel" : "+ Add User"}
            </button>
          </div>

          {showAddUser && (
            <div style={{ padding: "1rem", borderBottom: "1px solid #ddd" }}>
              <h3>Add New User</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <label>
                  Username
                  <input
                    type="text"
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    required
                    style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                    style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
                  <div
                    onClick={() => setNewUser({ ...newUser, is_admin: !newUser.is_admin })}
                    style={{
                      position: "relative",
                      width: "48px",
                      height: "24px",
                      backgroundColor: newUser.is_admin ? "#8193A4" : "#cbd5e1",
                      borderRadius: "12px",
                      transition: "background-color 0.2s ease",
                      cursor: "pointer",
                      flexShrink: 0
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: "2px",
                        left: newUser.is_admin ? "26px" : "2px",
                        width: "20px",
                        height: "20px",
                        backgroundColor: "#ffffff",
                        borderRadius: "50%",
                        transition: "left 0.2s ease",
                        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)"
                      }}
                    />
                  </div>
                  <span style={{ userSelect: "none" }}>Admin User</span>
                </label>
                {isSuperAdmin && (
                  <label>
                    Business (optional - leave empty for super admin)
                    <select
                      value={newUser.business_id || ""}
                      onChange={(e) => setNewUser({ ...newUser, business_id: e.target.value ? parseInt(e.target.value) : null })}
                      style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                    >
                      <option value="">None (Super Admin)</option>
                      {businesses.map(business => (
                        <option key={business.id} value={business.id}>
                          {business.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="primary"
                  onClick={handleCreateUser}
                  style={{ alignSelf: "flex-start" }}
                >
                  Create User
                </button>
              </div>
            </div>
          )}

          <div style={{ padding: "1rem" }}>
            {loadingUsers ? (
              <p>Loading users...</p>
            ) : users.length === 0 ? (
              <p className="empty">No users found</p>
            ) : (
              <ul className="list">
                {users.map((user) => (
                  <li key={user.id} className="list-item">
                    <div className="list-main">
                      <div className="list-title">
                        {user.username} 
                        {user.is_admin && <span style={{ color: "#8193A4", fontSize: "0.875rem" }}>(Admin)</span>}
                        {user.is_super_admin && <span style={{ color: "#8193A4", fontSize: "0.875rem", fontWeight: "bold" }}>(Super Admin)</span>}
                        {isSuperAdmin && user.business_name && (
                          <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", color: "#2D3234", fontStyle: "italic" }}>
                            • {user.business_name}
                          </span>
                        )}
                      </div>
                      <div className="list-subtitle">
                        Created: {formatDate(user.created_at)}
                      </div>
                    </div>
                    <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                      {isSuperAdmin && (
                        <button
                          className="secondary"
                          onClick={() => handleChangePasswordClick(user)}
                          style={{ marginLeft: "auto" }}
                        >
                          Change Password
                        </button>
                      )}
                      {user.id !== currentUser.id && !user.is_super_admin && (
                        <button
                          className="danger"
                          onClick={() => handleDeleteUser(user.id)}
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
        </div>
      )}

      {adminTab === "businesses" && isSuperAdmin && (
        <div className="card">
          <div className="card-header">
            <h2>Business Management</h2>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button 
                className="primary" 
                onClick={() => {
                  setEditingBusiness(null);
                  setBusinessName("");
                  setCreateAdminUser(true);
                  setAdminUsername("");
                  setAdminPassword("");
                  setShowAddBusiness(true);
                }}
              >
                + Add New Business
              </button>
              {selectedBusinessId && (
                <button 
                  className="secondary" 
                  onClick={() => handleSwitchBusiness(null)}
                >
                  Switch to All Businesses
                </button>
              )}
              <button className="secondary" onClick={fetchBusinesses}>Refresh</button>
            </div>
          </div>

          {selectedBusinessId === null && (
            <div style={{ padding: "1rem", marginBottom: "1rem", backgroundColor: "rgba(129, 147, 164, 0.1)", borderLeft: "4px solid #8193A4", borderRadius: "0.25rem" }}>
              <strong>Viewing All Businesses</strong> - You are currently viewing data from all businesses. Switch to a specific business to filter data.
            </div>
          )}

          {businesses.length === 0 ? (
            <div style={{ padding: "1rem" }}>
              <p className="empty">No businesses yet. Click "Add New Business" to get started.</p>
            </div>
          ) : (
            <ul className="list">
              {businesses.map(business => (
                <li key={business.id} className="list-item">
                  <div className="list-main" style={{ flex: 1 }}>
                    <div className="list-title">
                      {business.name}
                      {selectedBusinessId === business.id && (
                        <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", color: "#2D3234", fontWeight: "bold" }}>
                          (Current)
                        </span>
                      )}
                    </div>
                    <div className="list-subtitle">
                      Created: {formatDate(business.created_at)}
                    </div>
                  </div>
                  <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                    {selectedBusinessId !== business.id && (
                      <button onClick={() => handleSwitchBusiness(business.id)}>Switch To</button>
                    )}
                    {selectedBusinessId === business.id && (
                      <button className="secondary" onClick={() => handleSwitchBusiness(null)}>View All</button>
                    )}
                    <button onClick={() => handleEditBusiness(business)}>Edit</button>
                    <button className="danger" onClick={() => handleDeleteBusiness(business.id)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showAddBusiness && (
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
        }} onClick={() => {
          setShowAddBusiness(false);
          setEditingBusiness(null);
          setBusinessName("");
        }}>
          <div style={{
            backgroundColor: "#D7E5D8",
            padding: "2rem",
            borderRadius: "0.5rem",
            maxWidth: "500px",
            width: "90%",
            color: "#2D3234"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ margin: 0, color: "#2D3234" }}>
                {editingBusiness ? "Edit Business" : "Add New Business"}
              </h2>
              <button onClick={() => {
                setShowAddBusiness(false);
                setEditingBusiness(null);
                setBusinessName("");
                setCreateAdminUser(true);
                setAdminUsername("");
                setAdminPassword("");
              }} style={{ color: "#2D3234", border: "1px solid #8193A4", background: "transparent", cursor: "pointer", fontSize: "1.5rem", padding: "0.25rem 0.5rem" }}>✕</button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "600", color: "#2D3234" }}>
                  Business Name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Enter business name..."
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    backgroundColor: "#fff",
                    color: "#2D3234"
                  }}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      editingBusiness ? handleUpdateBusiness() : handleCreateBusiness();
                    }
                  }}
                />
              </div>

              {!editingBusiness && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
                    <div
                      onClick={() => setCreateAdminUser(!createAdminUser)}
                      style={{
                        position: "relative",
                        width: "48px",
                        height: "24px",
                        backgroundColor: createAdminUser ? "#8193A4" : "#cbd5e1",
                        borderRadius: "12px",
                        transition: "background-color 0.2s ease",
                        cursor: "pointer",
                        flexShrink: 0
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: "2px",
                          left: createAdminUser ? "26px" : "2px",
                          width: "20px",
                          height: "20px",
                          backgroundColor: "#ffffff",
                          borderRadius: "50%",
                          transition: "left 0.2s ease",
                          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)"
                        }}
                      />
                    </div>
                    <span style={{ userSelect: "none" }}>Create Admin User for this Business</span>
                  </label>

                  {createAdminUser && (
                    <>
                      <div>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "600", color: "#2D3234" }}>
                          Admin Username
                        </label>
                        <input
                          type="text"
                          value={adminUsername}
                          onChange={(e) => setAdminUsername(e.target.value)}
                          placeholder="Enter admin username..."
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
                          Admin Password
                        </label>
                        <input
                          type="password"
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="Enter admin password..."
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
                    </>
                  )}
                </>
              )}

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button 
                  className="primary" 
                  onClick={editingBusiness ? handleUpdateBusiness : handleCreateBusiness}
                >
                  {editingBusiness ? "Update" : "Create"}
                </button>
                <button 
                  className="secondary"
                  onClick={() => {
                    setShowAddBusiness(false);
                    setEditingBusiness(null);
                    setBusinessName("");
                    setCreateAdminUser(true);
                    setAdminUsername("");
                    setAdminPassword("");
                  }}
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

      {showChangePasswordModal && selectedUserForPasswordChange && (
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
        }} onClick={handleCancelPasswordChange}>
          <div style={{
            backgroundColor: "#D7E5D8",
            padding: "2rem",
            borderRadius: "0.5rem",
            maxWidth: "500px",
            width: "90%",
            color: "#2D3234"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ margin: 0, color: "#2D3234" }}>
                Change Password for {selectedUserForPasswordChange.username}
              </h2>
              <button onClick={handleCancelPasswordChange} style={{ color: "#2D3234", border: "1px solid #8193A4", background: "transparent", cursor: "pointer", fontSize: "1.5rem", padding: "0.25rem 0.5rem" }}>✕</button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "600", color: "#2D3234" }}>
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password..."
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
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password..."
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #8193A4",
                    borderRadius: "0.25rem",
                    backgroundColor: "#fff",
                    color: "#2D3234"
                  }}
                  onKeyPress={(e) => {
                    if (e.key === "Enter") {
                      handleSavePasswordChange();
                    }
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button 
                  className="primary" 
                  onClick={handleSavePasswordChange}
                >
                  Change Password
                </button>
                <button 
                  className="secondary"
                  onClick={handleCancelPasswordChange}
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

