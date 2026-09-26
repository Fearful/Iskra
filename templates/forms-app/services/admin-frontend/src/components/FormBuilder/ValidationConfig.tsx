interface Field {
    fieldType: string;
    maxLength?: number;
    min?: number;
    max?: number;
    errorMessage?: string;
}

interface ValidationConfigProps {
    field: Field;
    onChange: (patch: Partial<Field>) => void;
}

export function ValidationConfig({ field, onChange }: ValidationConfigProps) {
    const showMaxLength = ['text', 'textarea', 'email'].includes(field.fieldType);
    const showMinMax = field.fieldType === 'number';

    return (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
            <p style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: '0.5rem', color: '#374151' }}>Validation</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {showMaxLength && (
                    <div>
                        <label style={labelStyle}>Max length</label>
                        <input
                            type="number"
                            value={field.maxLength ?? ''}
                            onChange={(e) =>
                                onChange({ maxLength: e.target.value ? Number(e.target.value) : undefined })
                            }
                            placeholder="e.g. 255"
                            style={inputStyle}
                        />
                    </div>
                )}

                {showMinMax && (
                    <>
                        <div>
                            <label style={labelStyle}>Min value</label>
                            <input
                                type="number"
                                value={field.min ?? ''}
                                onChange={(e) => onChange({ min: e.target.value ? Number(e.target.value) : undefined })}
                                style={inputStyle}
                            />
                        </div>
                        <div>
                            <label style={labelStyle}>Max value</label>
                            <input
                                type="number"
                                value={field.max ?? ''}
                                onChange={(e) => onChange({ max: e.target.value ? Number(e.target.value) : undefined })}
                                style={inputStyle}
                            />
                        </div>
                    </>
                )}
            </div>

            <div style={{ marginTop: '0.5rem' }}>
                <label style={labelStyle}>Custom error message (overrides default)</label>
                <input
                    value={field.errorMessage ?? ''}
                    onChange={(e) => onChange({ errorMessage: e.target.value || undefined })}
                    placeholder="Leave empty for default messages"
                    style={inputStyle}
                />
                <small style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                    Applies to all validation rules for this field
                </small>
            </div>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontWeight: 500,
    marginBottom: '0.25rem',
    fontSize: '0.8rem',
    color: '#4b5563',
};
const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.375rem 0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontSize: '0.875rem',
};
