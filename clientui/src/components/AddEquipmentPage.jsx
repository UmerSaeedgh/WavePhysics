import { useState, useEffect } from "react";

export default function AddEquipmentPage({ apiCall, setError, clients, sites, equipmentToEdit, previousView, onBack, onSuccess, currentUser, initialClientId, initialSiteId, isSuperAdmin, onNavigateToBusinesses }) {
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [availableSites, setAvailableSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [equipmentForm, setEquipmentForm] = useState({
    equipment_type_id: "",
    equipment_name: "",
    make: "",
    model: "",
    serial_number: "",
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
            make: record.make || "",
            model: record.model || "",
            serial_number: record.serial_number || "",
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
        make: equipmentForm.make || null,
        model: equipmentForm.model || null,
        serial_number: equipmentForm.serial_number || null,
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

  // Check if superadmin has no businesses/clients
  const hasNoBusinesses = isSuperAdmin && (!clients || clients.length === 0);

  return (
    <div className="card">
      <div className="card-header">
        <h2>{equipmentToEdit && equipmentToEdit.id ? "Edit Equipment" : "Add New Equipment"}</h2>
        <button onClick={onBack}>Back</button>
      </div>

      {hasNoBusinesses && (
        <div style={{ padding: "1rem", margin: "1rem", backgroundColor: "#fff3cd", border: "1px solid #ffc107", borderRadius: "0.25rem" }}>
          <p style={{ margin: 0, color: "#856404", fontWeight: "600" }}>
            No businesses or clients found. You need to create a business first before adding equipment.
          </p>
          {onNavigateToBusinesses && (
            <button
              className="primary"
              onClick={() => {
                if (onNavigateToBusinesses) {
                  onNavigateToBusinesses();
                }
              }}
              style={{ marginTop: "0.75rem" }}
            >
              Create Business
            </button>
          )}
        </div>
      )}

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
          <select
            name="equipment_type_id"
            value={equipmentForm.equipment_type_id}
            onChange={handleChange}
            required
          >
            <option value="">Select an equipment type</option>
            {equipmentTypes.map(type => (
              <option key={type.id} value={type.id.toString()}>
                {type.name}
              </option>
            ))}
          </select>
        </label>

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
          Make
          <input
            type="text"
            name="make"
            value={equipmentForm.make}
            onChange={handleChange}
            placeholder="e.g., Brand Name"
          />
        </label>

        <label>
          Model
          <input
            type="text"
            name="model"
            value={equipmentForm.model}
            onChange={handleChange}
            placeholder="e.g., Model ABC-123"
          />
        </label>

        <label>
          Serial Number
          <input
            type="text"
            name="serial_number"
            value={equipmentForm.serial_number}
            onChange={handleChange}
            placeholder="e.g., 12345"
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

