export default function ContactManagementSection({ site, client, contactLinks, onRefreshContacts, onEditContact, apiCall, setError }) {
  async function handleDeleteLink(link) {
    const scope = site ? "SITE" : "CLIENT";
    const scopeId = site ? site.id : client?.id;
    if (!window.confirm("Remove this contact?")) return;
    try {
      const links = await apiCall(`/contact-links?scope=${scope}&scope_id=${scopeId}`);
      const actualLink = links.find(l => 
        l.contact_id === link.contact_id && 
        l.role === link.role &&
        l.scope === scope
      );
      if (actualLink) {
        await apiCall(`/contact-links/${actualLink.id}`, { method: "DELETE" });
        await onRefreshContacts();
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
          <button 
            className="primary" 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onEditContact) {
                onEditContact(null);
              }
            }}
          >
            + Add New Contact
          </button>
        </div>

        {contactLinks.length === 0 ? (
          <p className="empty">No contacts linked to this {site ? "site" : "client"}. Click "Add New Contact" to get started.</p>
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
                  <button 
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (onEditContact) {
                        onEditContact(link);
                      }
                    }}
                  >
                    Edit
                  </button>
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

