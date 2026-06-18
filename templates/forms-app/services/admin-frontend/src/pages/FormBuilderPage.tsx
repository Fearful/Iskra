import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { formsApi } from '../api/client';
import { FieldEditor } from '../components/FormBuilder/FieldEditor';
import { FieldList } from '../components/FormBuilder/FieldList';

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

export function FormBuilderPage() {
    const { spaceId } = useParams<{ spaceId: string }>();
    const navigate = useNavigate();

    const [title, setTitle] = useState('');
    const [slug, setSlug] = useState('');
    const [description, setDescription] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
    const [fields, setFields] = useState<Field[]>([]);
    const [editingField, setEditingField] = useState<number | null>(null);
    const [error, setError] = useState('');

    function addField() {
        setFields([
            ...fields,
            {
                fieldType: 'text',
                label: '',
                name: '',
                position: fields.length,
                required: false,
            },
        ]);
        setEditingField(fields.length);
    }

    function updateField(index: number, field: Field) {
        const updated = [...fields];
        updated[index] = field;
        setFields(updated);
    }

    function removeField(index: number) {
        const updated = fields.filter((_, i) => i !== index).map((f, i) => ({ ...f, position: i }));
        setFields(updated);
        setEditingField(null);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (fields.length === 0) {
            setError('Add at least one field');
            return;
        }

        try {
            await formsApi.create(spaceId!, {
                title,
                slug,
                description: description || undefined,
                startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
                fields,
            });
            navigate(`/spaces/${spaceId}`);
        } catch (err: any) {
            setError(err.message);
        }
    }

    return (
        <div>
            <h1>New Form</h1>
            {error && <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>}

            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div>
                        <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.25rem' }}>Title</label>
                        <input value={title} onChange={(e) => setTitle(e.target.value)} required
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4 }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.25rem' }}>Slug</label>
                        <input value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]+"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4 }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.25rem' }}>Description</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4, minHeight: 60 }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.25rem' }}>Opens at</label>
                            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4 }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.25rem' }}>Closes at</label>
                            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4 }} />
                        </div>
                    </div>
                </div>

                <h2 style={{ marginBottom: '1rem' }}>Fields</h2>

                <FieldList
                    fields={fields}
                    editingField={editingField}
                    onEdit={setEditingField}
                    onRemove={removeField}
                    onUpdate={updateField}
                />

                <button type="button" onClick={addField}
                    style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', border: '1px dashed #9ca3af', borderRadius: 4, background: 'none', cursor: 'pointer', color: '#6b7280' }}>
                    + Add Field
                </button>

                <div style={{ marginTop: '2rem', display: 'flex', gap: '0.5rem' }}>
                    <button type="submit"
                        style={{ padding: '0.75rem 1.5rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 500 }}>
                        Create Form
                    </button>
                    <button type="button" onClick={() => navigate(`/spaces/${spaceId}`)}
                        style={{ padding: '0.75rem 1.5rem', background: '#f3f4f6', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
}
