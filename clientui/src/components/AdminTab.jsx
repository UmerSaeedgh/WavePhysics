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

  const [selectedBusinessForImport, setSelectedBusinessForImport] = useState(null);

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

  // Business management functions
  async function handleCreateBusiness() {
    if (!businessName.trim()) {
      setError("Business name is required");
      return;
    }
    try {
      await apiCall("/businesses", {
        method: "POST",
        body: JSON.stringify({ name: businessName.trim() })
      });
      setBusinessName("");
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
    if (!window.confirm("Delete this business? All associated data (clients, sites, equipment, etc.) will be deleted.")) return;
    try {
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
        <div className="card">
          <div className="card-header">
            <h2>Utilities</h2>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            <div>
              <h3>Import Equipments</h3>
              <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1rem" }}>
                Import equipment records from Excel file. Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date.
                {isSuperAdmin && " Optional column: Business (if not provided, will use business from Excel file)."}
                <br />
                <strong>Note:</strong> If client or site doesn't exist, the row will be skipped. If equipment identifier doesn't exist, a new equipment will be created.
              </p>
              {isSuperAdmin && (
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                    Business (Optional - leave empty to use Business column from Excel)
                  </label>
                  <select
                    value={selectedBusinessForImport || ""}
                    onChange={(e) => setSelectedBusinessForImport(e.target.value ? parseInt(e.target.value) : null)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid #8193A4",
                      borderRadius: "0.25rem",
                      fontSize: "0.9rem"
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

            <div>
              <h3>Temporary Data Upload</h3>
              <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1rem" }}>
                Import equipment records from Excel file. Required columns: Client, Site, Equipment Type, Equipment Name, Anchor Date.
                {isSuperAdmin && " Optional column: Business (if not provided, will use business from Excel file or create it)."}
                <br />
                <strong>Note:</strong> If client or site doesn't exist, they will be created automatically. If equipment identifier doesn't exist, a new equipment will be created.
                {isSuperAdmin && " If business doesn't exist, it will be created automatically."}
              </p>
              {isSuperAdmin && (
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "#2D3234" }}>
                    Business (Optional - leave empty to use Business column from Excel)
                  </label>
                  <select
                    value={selectedBusinessForImport || ""}
                    onChange={(e) => setSelectedBusinessForImport(e.target.value ? parseInt(e.target.value) : null)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid #8193A4",
                      borderRadius: "0.25rem",
                      fontSize: "0.9rem"
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
                      </div>
                      <div className="list-subtitle">
                        Created: {formatDate(user.created_at)}
                      </div>
                    </div>
                    {user.id !== currentUser.id && !user.is_super_admin && (
                      <button
                        className="secondary"
                        onClick={() => handleDeleteUser(user.id)}
                        style={{ marginLeft: "auto" }}
                      >
                        Delete
                      </button>
                    )}
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
    </div>
  );
}

