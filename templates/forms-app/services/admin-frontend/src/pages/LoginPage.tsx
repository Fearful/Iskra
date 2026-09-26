import { useState } from 'react';
import { useNavigate } from 'react-router';
import { authApi } from '../api/client';

const inputStyle = { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4 };

export function LoginPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        try {
            await authApi.signIn(email, password);
            navigate('/');
        } catch {
            setError('Invalid email or password');
        }
    }

    return (
        <div style={{ maxWidth: 360, margin: '4rem auto', padding: '1rem' }}>
            <h1>Forms Admin</h1>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    autoComplete="username"
                    required
                    style={inputStyle}
                />
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                    style={inputStyle}
                />
                <button
                    type="submit"
                    style={{
                        padding: '0.5rem 1rem',
                        background: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                    }}
                >
                    Sign in
                </button>
                {error && <p style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
            </form>
        </div>
    );
}
