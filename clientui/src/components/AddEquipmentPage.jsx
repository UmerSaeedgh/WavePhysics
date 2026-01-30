import { useState, useEffect } from "react";

export default function AddEquipmentPage({ apiCall, setError, clients, sites, equipmentToEdit, previousView, onBack, onSuccess, currentUser, initialClientId, initialSiteId }) {
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [availableSites, setAvailableSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showNewTypeForm, setShowNewTypeForm] = useState(false);
  const [newTypeForm, setNewTypeForm] = useState({
    name: "",
    interval_weeks: "52",
    rrule: "FREQ=WEEKLY;INTERVAL=52",
    default_lead_weeks: "4",
    active: true,
  });
  const [equipmentForm, setEquipmentForm] = useState({
    equipment_type_id: "",
    equipment_name: "",
    anchor_date: "",
    due_date: "",
    interval_weeks: "",
    lead_weeks: "",
    timezone: "",
    notes: "",
    active: true,
  });

  useEffect(() => {
    async function loadData() {
      if (equipmentToEdit && equipmentToEdit.id) {
        try {
          const record = await apiCall(`/equipment-records/${equipmentToEdit.id}`);
          setSelectedClientId(record.client_id.toString());
          setSelectedSiteId(record.site_id.toString());
          await fetchSitesForClient(record.client_id);
          setEquipmentForm({
            equipment_type_id: record.equipment_type_id?.toString() || "",
            equipment_name: record.equipment_name || "",
            anchor_date: record.anchor_date || "",
            due_date: record.due_date || "",
            interval_weeks: record.interval_weeks?.toString() || "",
            lead_weeks: record.lead_weeks?.toString() || "",
            timezone: record.timezone || "",
            notes: record.notes || "",
            active: record.active !== undefined ? record.active : true,
          });
        } catch (err) {
          console.error("Failed to load equipment record:", err);
        }
      } else if (equipmentToEdit && equipmentToEdit.client) {
        setSelectedClientId(equipmentToEdit.client.id.toString());
        if (equipmentToEdit.site) {
          setSelectedSiteId(equipmentToEdit.site.id.toString());
        }
        await fetchSitesForClient(equipmentToEdit.client.id);
      } else if (initialClientId) {
        // Use initial values from filter (when creating new equipment from filtered view)
        setSelectedClientId(initialClientId.toString());
        await fetchSitesForClient(initialClientId);
        if (initialSiteId) {
          setSelectedSiteId(initialSiteId.toString());
        }
      }
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentToEdit, initialClientId, initialSiteId]);

  // Fetch equipment types on mount
  useEffect(() => {
    async function fetchTypes() {
      try {
        console.log("Fetching equipment types...");
        const types = await apiCall("/equipment-types?active_only=true");
        console.log("Equipment types received:", types);
        if (Array.isArray(types)) {
          console.log(`Setting ${types.length} equipment types`);
          setEquipmentTypes(types);
        } else {
          console.warn("Equipment types response is not an array:", types);
          setEquipmentTypes([]);
        }
      } catch (err) {
        console.error("Failed to load equipment types:", err);
        setError(err.message || "Failed to load equipment types");
        setEquipmentTypes([]);
      }
    }
    fetchTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedClientId) {
      fetchSitesForClient(selectedClientId);
    } else {
      setAvailableSites([]);
      setSelectedSiteId("");
    }
  }, [selectedClientId]);

  async function fetchSitesForClient(clientId) {
    try {
      const data = await apiCall(`/sites?client_id=${clientId}`);
      setAvailableSites(data || []);
    } catch (err) {
      setAvailableSites([]);
    }
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setEquipmentForm(prev => {
      const updated = { ...prev, [name]: type === "checkbox" ? checked : value };
      if (name === "equipment_type_id" && value) {
        const selectedType = equipmentTypes.find(t => t.id === parseInt(value));
        if (selectedType && selectedType.interval_weeks) {
          updated.interval_weeks = selectedType.interval_weeks.toString();
        }
      }
      return updated;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (!selectedClientId || !selectedSiteId) {
        setError("Client and Site are required");
        return;
      }
      if (!equipmentForm.equipment_type_id || !equipmentForm.equipment_name || !equipmentForm.anchor_date) {
        setError("Equipment Type, Equipment Name, and Anchor Date are required");
        return;
      }

      const payload = {
        client_id: parseInt(selectedClientId),
        site_id: parseInt(selectedSiteId),
        equipment_type_id: parseInt(equipmentForm.equipment_type_id),
        equipment_name: equipmentForm.equipment_name,
        anchor_date: equipmentForm.anchor_date,
        due_date: equipmentForm.due_date || null,
        interval_weeks: equipmentForm.interval_weeks ? parseInt(equipmentForm.interval_weeks) : 52,
        lead_weeks: equipmentForm.lead_weeks ? parseInt(equipmentForm.lead_weeks) : null,
        timezone: equipmentForm.timezone || null,
        notes: equipmentForm.notes || null,
        active: currentUser?.is_admin ? equipmentForm.active : true,
      };

      if (equipmentToEdit && equipmentToEdit.id) {
        await apiCall(`/equipment-records/${equipmentToEdit.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiCall("/equipment-records", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      // error already set
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>{equipmentToEdit && equipmentToEdit.id ? "Edit Equipment" : "Add New Equipment"}</h2>
        <button onClick={onBack}>Back</button>
      </div>

      <form onSubmit={handleSubmit} style={{ padding: "1rem" }}>
        <label>
          Client *
          <select
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setSelectedSiteId("");
            }}
            required
          >
            <option value="">Select a client</option>
            {clients.map(client => (
              <option key={client.id} value={client.id.toString()}>
                {client.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Site *
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            required
            disabled={!selectedClientId}
          >
            <option value="">{selectedClientId ? "Select a site" : "Select client first"}</option>
            {availableSites.map(site => (
              <option key={site.id} value={site.id.toString()}>
                {site.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Equipment Type *
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <select
              name="equipment_type_id"
              value={equipmentForm.equipment_type_id}
              onChange={handleChange}
              required
              style={{ flex: 1 }}
            >
              <option value="">Select an equipment type</option>
              {equipmentTypes.map(type => (
                <option key={type.id} value={type.id.toString()}>
                  {type.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowNewTypeForm(true)}
              style={{ whiteSpace: "nowrap" }}
            >
              + Add New Type
            </button>
          </div>
        </label>

        {showNewTypeForm && (
          <div style={{ 
            padding: "1rem", 
            backgroundColor: "#8193A4", 
            borderRadius: "0.5rem", 
            marginTop: "0.5rem",
            border: "1px solid #2D3234"
          }}>
            <h4 style={{ marginTop: 0, marginBottom: "1rem", color: "#2D3234" }}>Add New Equipment Type</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ color: "#2D3234" }}>
                Name *
                <input
                  type="text"
                  value={newTypeForm.name}
                  onChange={(e) => setNewTypeForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                  placeholder="Equipment type name"
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                />
              </label>
              <label style={{ color: "#2D3234" }}>
                Interval (weeks) *
                <input
                  type="number"
                  value={newTypeForm.interval_weeks}
                  onChange={(e) => {
                    const interval = e.target.value;
                    setNewTypeForm(prev => ({ 
                      ...prev, 
                      interval_weeks: interval,
                      rrule: `FREQ=WEEKLY;INTERVAL=${interval || 52}`
                    }));
                  }}
                  required
                  min="1"
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                />
              </label>
              <label style={{ color: "#2D3234" }}>
                Default Lead Weeks *
                <input
                  type="number"
                  value={newTypeForm.default_lead_weeks}
                  onChange={(e) => setNewTypeForm(prev => ({ ...prev, default_lead_weeks: e.target.value }))}
                  required
                  min="0"
                  style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                />
              </label>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    if (!newTypeForm.name.trim()) {
                      setError("Equipment type name is required");
                      return;
                    }
                    try {
                      const newType = await apiCall("/equipment-types", {
                        method: "POST",
                        body: JSON.stringify({
                          name: newTypeForm.name,
                          interval_weeks: parseInt(newTypeForm.interval_weeks) || 52,
                          rrule: newTypeForm.rrule || `FREQ=WEEKLY;INTERVAL=${parseInt(newTypeForm.interval_weeks) || 52}`,
                          default_lead_weeks: parseInt(newTypeForm.default_lead_weeks) || 4,
                          active: newTypeForm.active,
                        }),
                      });
                      const types = await apiCall("/equipment-types?active_only=true");
                      setEquipmentTypes(types || []);
                      setEquipmentForm(prev => ({
                        ...prev,
                        equipment_type_id: newType.id.toString(),
                        interval_weeks: newType.interval_weeks.toString(),
                      }));
                      setNewTypeForm({
                        name: "",
                        interval_weeks: "52",
                        rrule: "FREQ=WEEKLY;INTERVAL=52",
                        default_lead_weeks: "4",
                        active: true,
                      });
                      setShowNewTypeForm(false);
                    } catch (err) {
                      // error already set
                    }
                  }}
                >
                  Create
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setShowNewTypeForm(false);
                    setNewTypeForm({
                      name: "",
                      interval_weeks: "52",
                      rrule: "FREQ=WEEKLY;INTERVAL=52",
                      default_lead_weeks: "4",
                      active: true,
                    });
                  }}
                  style={{ 
                    color: "#2D3234", 
                    border: "1px solid #2D3234",
                    background: "transparent"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <label>
          Equipment Name *
          <input
            type="text"
            name="equipment_name"
            value={equipmentForm.equipment_name}
            onChange={handleChange}
            required
            placeholder="e.g., Scanner Model XYZ, Room 101"
          />
        </label>

        <label>
          Anchor Date *
          <input
            type="date"
            name="anchor_date"
            value={equipmentForm.anchor_date}
            onChange={handleChange}
            required
          />
        </label>

        <label>
          Due Date
          <input
            type="date"
            name="due_date"
            value={equipmentForm.due_date}
            onChange={handleChange}
          />
        </label>

        <label>
          Interval (weeks) *
          <input
            type="number"
            name="interval_weeks"
            value={equipmentForm.interval_weeks}
            onChange={handleChange}
            min="1"
            required
            placeholder="e.g., 52"
          />
        </label>

        <label>
          Lead Weeks
          <input
            type="number"
            name="lead_weeks"
            value={equipmentForm.lead_weeks}
            onChange={handleChange}
            min="0"
          />
        </label>

        <label>
          Timezone
          <input
            type="text"
            name="timezone"
            value={equipmentForm.timezone}
            onChange={handleChange}
            placeholder="e.g., America/New_York"
          />
        </label>

        <label>
          Notes
          <textarea
            name="notes"
            value={equipmentForm.notes}
            onChange={handleChange}
            rows="3"
          />
        </label>

        {currentUser?.is_admin && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
            <div
              onClick={() => setEquipmentForm(prev => ({ ...prev, active: !prev.active }))}
              style={{
                position: "relative",
                width: "48px",
                height: "24px",
                backgroundColor: equipmentForm.active ? "#8193A4" : "#cbd5e1",
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
                  left: equipmentForm.active ? "26px" : "2px",
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
        )}

        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Saving..." : (equipmentToEdit && equipmentToEdit.id ? "Update" : "Create")}
          </button>
          <button type="button" onClick={onBack}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

