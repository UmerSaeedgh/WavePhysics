import { useState, useEffect } from "react";

export default function ClientSitesView({ client, sites, clientEquipments, onRefreshSites, onRefreshEquipments, onSiteClick, onBack, onAddSite, onEditSite, apiCall, setError, currentUser, allEquipments, onRefreshAllCounts }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (client && client.id) {
      onRefreshSites();
      onRefreshEquipments();
    }
  }, [client?.id]);

  async function handleDelete(siteId) {
    if (!window.confirm("Delete this site?")) return;
    try {
      await apiCall(`/sites/${siteId}`, { method: "DELETE" });
      await onRefreshSites();
      // Refresh all counts
      if (onRefreshAllCounts) {
        onRefreshAllCounts();
      }
    } catch (err) {
      // error already set
    }
  }

  const filteredAndSortedSites = sites
    .filter(site => {
      // First, ensure site belongs to current client
      if (client && client.id && site.client_id !== client.id) {
        return false;
      }
      // Then apply search filter
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

  const activeFilterCount = [searchTerm, sortOrder !== "asc"].filter(Boolean).length;

  // Check if site has equipment
  function siteHasEquipment(siteId) {
    return allEquipments && allEquipments.some(eq => eq.site_id === siteId);
  }

  // Count equipments for a site
  function countEquipmentsForSite(siteId) {
    return allEquipments ? allEquipments.filter(eq => eq.site_id === siteId).length : 0;
  }

  // Check if user is admin
  const isAdmin = currentUser && (currentUser.is_admin === true || currentUser.is_admin === 1);

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack} style={{ padding: "0.5rem 0.75rem", minWidth: "auto" }}>←</button>
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
                  <div className="list-title">
                    {site.name}
                    <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", color: "#8193A4", fontWeight: "normal" }}>
                      ({countEquipmentsForSite(site.id)} equipments)
                    </span>
                  </div>
                  <div className="list-subtitle">
                    {site.address && `${site.address} • `}
                    {site.timezone}
                  </div>
                </div>
                <div className="list-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => {
                    if (onEditSite) {
                      onEditSite(site);
                    }
                  }}>Edit</button>
                  {isAdmin && !siteHasEquipment(site.id) && (
                    <button className="danger" onClick={() => handleDelete(site.id)}>Delete</button>
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

