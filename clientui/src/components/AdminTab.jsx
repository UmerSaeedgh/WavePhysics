import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../config";
import { formatDate } from "../utils/formatDate";

export default function AdminTab({ apiCall, setError, currentUser }) {
  const [adminTab, setAdminTab] = useState("utilities");
  const [users, setUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", is_admin: false });
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

  useEffect(() => {
    if (adminTab === "users" && currentUser?.is_admin) {
      fetchUsers();
    }
  }, [adminTab, currentUser]);

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
      setNewUser({ username: "", password: "", is_admin: false });
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
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={newUser.is_admin}
                    onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })}
                  />
                  Admin User
                </label>
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
                        {user.username} {user.is_admin && <span style={{ color: "#8193A4", fontSize: "0.875rem" }}>(Admin)</span>}
                      </div>
                      <div className="list-subtitle">
                        Created: {formatDate(user.created_at)}
                      </div>
                    </div>
                    {user.id !== currentUser.id && (
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
    </div>
  );
}

