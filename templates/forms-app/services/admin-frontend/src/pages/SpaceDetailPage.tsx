import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { spacesApi, formsApi } from '../api/client';

export function SpaceDetailPage() {
    const { id } = useParams<{ id: string }>();
    const [space, setSpace] = useState<any>(null);
    const [forms, setForms] = useState<any[]>([]);
    const [error, setError] = useState('');

    useEffect(() => {
        if (id) {
            loadData(id);
        }
    }, [id]);

    async function loadData(spaceId: string) {
        try {
            const [spaceRes, formsRes] = await Promise.all([
                spacesApi.get(spaceId),
                formsApi.listBySpace(spaceId),
            ]);
            setSpace(spaceRes.data);
            setForms(formsRes.data);
        } catch (err: any) {
            setError(err.message);
        }
    }

    if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
    if (!space) return <p>Loading...</p>;

    return (
        <div>
            <Link to="/" style={{ color: '#6b7280', textDecoration: 'none' }}>&larr; Back to Spaces</Link>
            <h1 style={{ marginTop: '0.5rem' }}>{space.name}</h1>
            <p style={{ color: '#6b7280' }}>Slug: /{space.slug}</p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
                <h2>Forms</h2>
                <Link
                    to={`/spaces/${id}/forms/new`}
                    style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', borderRadius: 4, textDecoration: 'none' }}
                >
                    New Form
                </Link>
            </div>

            {forms.length === 0 ? (
                <p style={{ color: '#9ca3af', marginTop: '1rem' }}>No forms yet.</p>
            ) : (
                <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                            <th style={{ padding: '0.5rem' }}>Title</th>
                            <th style={{ padding: '0.5rem' }}>Slug</th>
                            <th style={{ padding: '0.5rem' }}>Status</th>
                            <th style={{ padding: '0.5rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {forms.map((f) => (
                            <tr key={f.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '0.5rem' }}>
                                    <Link to={`/forms/${f.id}`} style={{ color: '#2563eb' }}>{f.title}</Link>
                                </td>
                                <td style={{ padding: '0.5rem', color: '#6b7280' }}>/{f.slug}</td>
                                <td style={{ padding: '0.5rem' }}>
                                    <StatusBadge status={f.status} />
                                </td>
                                <td style={{ padding: '0.5rem' }}>
                                    <Link to={`/forms/${f.id}/answers`} style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                                        Answers
                                    </Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, { bg: string; text: string }> = {
        draft: { bg: '#f3f4f6', text: '#374151' },
        scheduled: { bg: '#fef3c7', text: '#92400e' },
        open: { bg: '#dcfce7', text: '#166534' },
        closed: { bg: '#fee2e2', text: '#991b1b' },
    };
    const c = colors[status] ?? colors.draft;
    return (
        <span style={{ padding: '0.125rem 0.5rem', borderRadius: 9999, fontSize: '0.75rem', fontWeight: 500, background: c.bg, color: c.text }}>
            {status}
        </span>
    );
}
