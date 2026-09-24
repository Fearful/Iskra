import { BrowserRouter, Routes, Route } from 'react-router';
import { Layout } from './components/Layout';
import { SpacesPage } from './pages/SpacesPage';
import { SpaceDetailPage } from './pages/SpaceDetailPage';
import { FormBuilderPage } from './pages/FormBuilderPage';
import { FormAnswersPage } from './pages/FormAnswersPage';
import { LoginPage } from './pages/LoginPage';

export function App() {
    return (
        <BrowserRouter basename="/admin">
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<Layout />}>
                    <Route path="/" element={<SpacesPage />} />
                    <Route path="/spaces/:id" element={<SpaceDetailPage />} />
                    <Route path="/spaces/:spaceId/forms/new" element={<FormBuilderPage />} />
                    <Route path="/forms/:id/answers" element={<FormAnswersPage />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
