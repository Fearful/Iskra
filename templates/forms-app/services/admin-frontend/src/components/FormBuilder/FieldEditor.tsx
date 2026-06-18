import { ValidationConfig } from './ValidationConfig';

const FIELD_TYPES = ['text', 'number', 'email', 'select', 'checkbox', 'radio', 'textarea', 'date'] as const;

interface Field {
    fieldType: string;
    label: string;
    name: string;
    position: number;
    required: boolean;
    options?: { label: string; value: string }[];
    maxLength?: number;
    min?: number;
    max?: number;
    placeholder?: string;
    helpText?: string;
    errorMessage?: string;
}

interface FieldEditorProps {
    field: Field;
    onChange: (field: Field) => void;
}

export function FieldEditor({ field, onChange }: FieldEditorProps) {
    const update = (patch: Partial<Field>) => onChange({ ...field, ...patch });
    const hasOptions = ['select', 'radio', 'checkbox'].includes(field.fieldType);

    return (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                    <label style={labelStyle}>Type</label>
                    <select value={field.fieldType} onChange={(e) => update({ fieldType: e.target.value })} style={inputStyle}>
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Name (code)</label>
                    <input value={field.name} onChange={(e) => update({ name: e.target.value })}
                        placeholder="field_name" pattern="[a-zA-Z_][a-zA-Z0-9_]*" style={inputStyle} />
                </div>
            </div>

            <div>
                <label style={labelStyle}>Label</label>
                <input value={field.label} onChange={(e) => update({ label: e.target.value })} placeholder="Display label" style={inputStyle} />
            </div>

            <div>
                <label style={labelStyle}>Placeholder</label>
                <input value={field.placeholder ?? ''} onChange={(e) => update({ placeholder: e.target.value || undefined })} style={inputStyle} />
            </div>

            <div>
                <label style={labelStyle}>Help text</label>
                <input value={field.helpText ?? ''} onChange={(e) => update({ helpText: e.target.value || undefined })} style={inputStyle} />
            </div>

            <div>
                <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" checked={field.required} onChange={(e) => update({ required: e.target.checked })} />
                    Required
                </label>
            </div>

            {hasOptions && (
                <OptionsEditor
                    options={field.options ?? []}
                    onChange={(options) => update({ options })}
                />
            )}

            <ValidationConfig field={field} onChange={update} />
        </div>
    );
}

function OptionsEditor({ options, onChange }: { options: { label: string; value: string }[]; onChange: (opts: { label: string; value: string }[]) => void }) {
    function addOption() {
        onChange([...options, { label: '', value: '' }]);
    }
    function updateOption(i: number, patch: Partial<{ label: string; value: string }>) {
        const updated = [...options];
        updated[i] = { ...updated[i], ...patch };
        onChange(updated);
    }
    function removeOption(i: number) {
        onChange(options.filter((_, idx) => idx !== i));
    }

    return (
        <div>
            <label style={labelStyle}>Options</label>
            {options.map((opt, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <input value={opt.label} onChange={(e) => updateOption(i, { label: e.target.value })}
                        placeholder="Label" style={{ ...inputStyle, flex: 1 }} />
                    <input value={opt.value} onChange={(e) => updateOption(i, { value: e.target.value })}
                        placeholder="Value" style={{ ...inputStyle, flex: 1 }} />
                    <button type="button" onClick={() => removeOption(i)} style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                        x
                    </button>
                </div>
            ))}
            <button type="button" onClick={addOption}
                style={{ fontSize: '0.8rem', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', marginTop: '0.25rem' }}>
                + Add option
            </button>
        </div>
    );
}

const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 500, marginBottom: '0.25rem', fontSize: '0.85rem' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' };
