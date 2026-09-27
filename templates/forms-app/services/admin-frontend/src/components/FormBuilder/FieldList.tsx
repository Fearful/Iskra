import { FieldEditor } from './FieldEditor';

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

interface FieldListProps {
    fields: Field[];
    editingField: number | null;
    onEdit: (index: number | null) => void;
    onRemove: (index: number) => void;
    onUpdate: (index: number, field: Field) => void;
}

export function FieldList({ fields, editingField, onEdit, onRemove, onUpdate }: FieldListProps) {
    if (fields.length === 0) {
        return <p style={{ color: '#9ca3af', padding: '1rem 0' }}>No fields added yet.</p>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {fields.map((field, i) => (
                <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                    <div
                        onClick={() => onEdit(editingField === i ? null : i)}
                        style={{
                            padding: '0.75rem 1rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer',
                            background: editingField === i ? '#f9fafb' : '#fff',
                        }}
                    >
                        <div>
                            <span style={{ fontWeight: 500 }}>{field.label || '(untitled)'}</span>
                            <span style={{ color: '#9ca3af', marginLeft: '0.5rem', fontSize: '0.875rem' }}>
                                {field.fieldType}
                            </span>
                            {field.required && <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>*</span>}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemove(i);
                                }}
                                style={{
                                    color: '#dc2626',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '0.875rem',
                                }}
                            >
                                Remove
                            </button>
                        </div>
                    </div>

                    {editingField === i && (
                        <div style={{ padding: '1rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
                            <FieldEditor field={field} onChange={(updated) => onUpdate(i, updated)} />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
