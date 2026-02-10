import { useState, useEffect } from "react";

export default function SuperAdminView({ apiCall, setError, currentUser, onBusinessSwitch, onRefresh }) {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState(null);
  const [businessName, setBusinessName] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState(null);
  const [createAdminUser, setCreateAdminUser] = useState(true);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  useEffect(() => {
    fetchBusinesses();
    if (currentUser?.business_id) {
      setSelectedBusinessId(currentUser.business_id);
    }
  }, [currentUser]);

  async function fetchBusinesses() {
    setLoading(true);
    setError("");
    try {
      const data = await apiCall("/businesses");
      setBusinesses(data || []);
    } catch (err) {
      const errorMessage = err.message || "Failed to load businesses";
      setError(errorMessage);
      console.error("Error fetching businesses:", err);
    } finally {
      setLoading(false);
    }
  }

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
      setShowAddModal(false);
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
      if (onBusinessSwitch) {
        onBusinessSwitch(businessId);
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      // error already set
    }
  }

  function handleEditClick(business) {
    setEditingBusiness(business);
    setBusinessName(business.name);
    setCreateAdminUser(false); // Don't create admin when editing
    setAdminUsername("");
    setAdminPassword("");
    setShowAddModal(true);
  }

  function handleCancel() {
    setShowAddModal(false);
    setEditingBusiness(null);
    setBusinessName("");
    setCreateAdminUser(true);
    setAdminUsername("");
    setAdminPassword("");
  }

  if (loading && businesses.length === 0) {
    return <div className="card"><p>Loading...</p></div>;
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>Business Management</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="primary" onClick={() => {
              setEditingBusiness(null);
              setBusinessName("");
              setShowAddModal(true);
            }}>
              + Add New Business
            </button>
            <button className="secondary" onClick={fetchBusinesses}>Refresh</button>
          </div>
        </div>

        {businesses.length === 0 ? (
          <p className="empty">No businesses yet. Click "Add New Business" to get started.</p>
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
                    Created: {new Date(business.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                  {selectedBusinessId !== business.id && (
                    <button onClick={() => handleSwitchBusiness(business.id)}>Switch To</button>
                  )}
                  <button onClick={() => handleEditClick(business)}>Edit</button>
                  <button className="danger" onClick={() => handleDeleteBusiness(business.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddModal && (
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
        }} onClick={handleCancel}>
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
              <button onClick={handleCancel} style={{ color: "#2D3234", border: "1px solid #8193A4" }}>✕</button>
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
                  onClick={handleCancel}
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

