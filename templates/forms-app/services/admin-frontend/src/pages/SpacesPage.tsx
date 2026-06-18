import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { spacesApi } from '../api/client';

export function SpacesPage() {
    const [spaces, setSpaces] = useState<any[]>([]);
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        loadSpaces();
    }, []);

    async function loadSpaces() {
        try {
            const res = await spacesApi.list();
            setSpaces(res.data);
        } catch (err: any) {
            setError(err.message);
        }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        try {
            await spacesApi.create({ name, slug });
            setName('');
            setSlug('');
            await loadSpaces();
        } catch (err: any) {
            setError(err.message);
        }
    }

    return (
        <div>
            <h1>Spaces</h1>

            <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Space name"
                    required
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4 }}
                />
                <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="slug"
                    required
                    pattern="[a-z0-9-]+"
                    style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4 }}
                />
                <button type="submit" style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    Create
                </button>
            </form>

            {error && <p style={{ color: '#dc2626' }}>{error}</p>}

            <ul style={{ listStyle: 'none', padding: 0 }}>
                {spaces.map((s) => (
                    <li key={s.id} style={{ padding: '0.75rem', borderBottom: '1px solid #f3f4f6' }}>
                        <Link to={`/spaces/${s.id}`} style={{ fontWeight: 500, color: '#2563eb' }}>
                            {s.name}
                        </Link>
                        <span style={{ color: '#9ca3af', marginLeft: '0.5rem' }}>/{s.slug}</span>
                    </li>
                ))}
            </ul>

            {spaces.length === 0 && !error && <p style={{ color: '#9ca3af' }}>No spaces yet. Create one above.</p>}
        </div>
    );
}
