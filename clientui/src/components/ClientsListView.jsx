import { useState } from "react";

export default function ClientsListView({ clients, onRefresh, onClientClick, onViewSites, onEditClient, onAddClient, apiCall, setError, currentUser, allEquipments, sites, onRefreshAllCounts }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");
  const [showFilters, setShowFilters] = useState(false);

  async function handleDelete(clientId) {
    if (!window.confirm("Delete this client? All associated sites will be deleted.")) return;
    try {
      await apiCall(`/clients/${clientId}`, { method: "DELETE" });
      await onRefresh();
      // Refresh all counts
      if (onRefreshAllCounts) {
        onRefreshAllCounts();
      }
    } catch (err) {
      // error already set
    }
  }

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

  const activeFilterCount = [searchTerm, sortOrder !== "asc"].filter(Boolean).length;

  // Check if client has equipment
  function clientHasEquipment(clientId) {
    return allEquipments && allEquipments.some(eq => eq.client_id === clientId);
  }

  // Count sites for a client
  function countSitesForClient(clientId) {
    if (!sites || !Array.isArray(sites) || sites.length === 0) return 0;
    // Handle both number and string client_id
    const clientIdNum = typeof clientId === 'number' ? clientId : parseInt(clientId);
    if (isNaN(clientIdNum)) return 0;
    const count = sites.filter(site => {
      if (!site || site.client_id === undefined || site.client_id === null) return false;
      const siteClientId = typeof site.client_id === 'number' ? site.client_id : parseInt(site.client_id);
      return !isNaN(siteClientId) && siteClientId === clientIdNum;
    }).length;
    return count;
  }

  // Count equipments for a client
  function countEquipmentsForClient(clientId) {
    return allEquipments ? allEquipments.filter(eq => eq.client_id === clientId).length : 0;
  }

  // Check if user is admin
  const isAdmin = currentUser && (currentUser.is_admin === true || currentUser.is_admin === 1);

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
                  <div className="list-title">
                    {client.name}
                    <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", color: "#8193A4", fontWeight: "normal" }}>
                      ({countSitesForClient(client.id)} sites, {countEquipmentsForClient(client.id)} equipments)
                    </span>
                  </div>
                  <div className="list-subtitle">
                    {client.address && `${client.address} • `}
                    {client.billing_info && `Billing: ${client.billing_info} • `}
                    {client.notes}
                  </div>
                </div>
                <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => {
                    if (onEditClient) {
                      onEditClient(client);
                    }
                  }}>Edit</button>
                  {isAdmin && !clientHasEquipment(client.id) && (
                    <button className="danger" onClick={() => handleDelete(client.id)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

