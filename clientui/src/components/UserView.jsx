import { useState } from "react";
import AdminTab from "./AdminTab";

export default function UserView({ apiCall, setError, currentUser, onLogout }) {
  const [userTab, setUserTab] = useState("settings");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  async function handleChangePassword(e) {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All fields are required");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters long");
      return;
    }

    setChanging(true);
    try {
      await apiCall("/auth/change-password", {
        method: "PUT",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setSuccessMessage("Password changed successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message || "Failed to change password");
    } finally {
      setChanging(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2>User Settings</h2>
        </div>
        
        <nav className="tabs" style={{ marginBottom: "1rem", padding: "0 1rem", paddingTop: "1rem" }}>
          <button
            className={userTab === "settings" ? "active" : ""}
            onClick={() => setUserTab("settings")}
          >
            Settings
          </button>
          {currentUser?.is_admin && (
            <button
              className={userTab === "admin" ? "active" : ""}
              onClick={() => setUserTab("admin")}
            >
              Admin
            </button>
          )}
        </nav>
        
        {userTab === "settings" && (
          <div style={{ padding: "1rem" }}>
            <div style={{ marginBottom: "2rem" }}>
              <h3>User Information</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div>
                  <strong>Username:</strong> {currentUser?.username}
                </div>
                <div>
                  <strong>Role:</strong> {currentUser?.is_admin ? "Admin" : "User"}
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #8193A4", paddingTop: "2rem" }}>
              <h3>Change Password</h3>
              {successMessage && (
                <div style={{ 
                  background: "rgba(215, 229, 216, 0.3)", 
                  border: "1px solid #8193A4", 
                  color: "#2D3234", 
                  padding: "0.75rem 1rem", 
                  borderRadius: "0.5rem", 
                  marginBottom: "1rem" 
                }}>
                  {successMessage}
                </div>
              )}
              <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "400px" }}>
                <label>
                  Current Password
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                  />
                </label>
                <label>
                  New Password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                  />
                </label>
                <label>
                  Confirm New Password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                  />
                </label>
                <button
                  type="submit"
                  className="primary"
                  disabled={changing}
                  style={{ alignSelf: "flex-start" }}
                >
                  {changing ? "Changing..." : "Change Password"}
                </button>
              </form>
            </div>

            <div style={{ borderTop: "1px solid #8193A4", paddingTop: "2rem", marginTop: "2rem" }}>
              <h3>Logout</h3>
              <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1rem" }}>
                Sign out of your account
              </p>
              <button
                onClick={onLogout}
                className="secondary"
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {userTab === "admin" && currentUser?.is_admin && (
          <AdminTab apiCall={apiCall} setError={setError} currentUser={currentUser} />
        )}
      </div>
    </div>
  );
}

