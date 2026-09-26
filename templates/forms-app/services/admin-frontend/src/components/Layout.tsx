import { Link, Outlet } from 'react-router';
import { authApi } from '../api/client';

export function Layout() {
    return (
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '1rem' }}>
            <header style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                    <Link
                        to="/"
                        style={{ fontWeight: 700, fontSize: '1.125rem', textDecoration: 'none', color: '#111' }}
                    >
                        Forms Admin
                    </Link>
                    <Link to="/" style={{ color: '#4b5563', textDecoration: 'none' }}>
                        Spaces
                    </Link>
                    <button
                        onClick={() => authApi.signOut().finally(() => window.location.assign('/admin/login'))}
                        style={{
                            marginLeft: 'auto',
                            background: 'none',
                            border: 'none',
                            color: '#4b5563',
                            cursor: 'pointer',
                        }}
                    >
                        Sign out
                    </button>
                </nav>
            </header>
            <main>
                <Outlet />
            </main>
        </div>
    );
}
