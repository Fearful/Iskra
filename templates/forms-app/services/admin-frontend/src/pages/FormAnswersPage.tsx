import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { formsApi } from '../api/client';

export function FormAnswersPage() {
    const { id } = useParams<{ id: string }>();
    const [form, setForm] = useState<any>(null);
    const [answers, setAnswers] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [error, setError] = useState('');

    useEffect(() => {
        if (id) loadData(id, page);
    }, [id, page]);

    async function loadData(formId: string, pg: number) {
        try {
            const [formRes, answersRes] = await Promise.all([
                formsApi.get(formId),
                formsApi.getAnswers(formId, pg),
            ]);
            setForm(formRes.data);
            setAnswers(answersRes.data);
            setTotal(answersRes.total);
        } catch (err: any) {
            setError(err.message);
        }
    }

    if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
    if (!form) return <p>Loading...</p>;

    const fieldNames = form.fields?.map((f: any) => f.name) ?? [];

    return (
        <div>
            <Link to={`/spaces/${form.spaceId}`} style={{ color: '#6b7280', textDecoration: 'none' }}>&larr; Back</Link>
            <h1 style={{ marginTop: '0.5rem' }}>Answers: {form.title}</h1>
            <p style={{ color: '#6b7280' }}>{total} total submissions</p>

            {answers.length === 0 ? (
                <p style={{ color: '#9ca3af', marginTop: '1rem' }}>No answers yet.</p>
            ) : (
                <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                                <th style={{ padding: '0.5rem' }}>Date</th>
                                {fieldNames.map((name: string) => (
                                    <th key={name} style={{ padding: '0.5rem' }}>{name}</th>
                                ))}
                                <th style={{ padding: '0.5rem' }}>Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {answers.map((a: any) => (
                                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                    <td style={{ padding: '0.5rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                                        {new Date(a.submittedAt).toLocaleString()}
                                    </td>
                                    {fieldNames.map((name: string) => (
                                        <td key={name} style={{ padding: '0.5rem' }}>
                                            {String(a.data?.[name] ?? '')}
                                        </td>
                                    ))}
                                    <td style={{ padding: '0.5rem', color: '#6b7280' }}>
                                        {a.recaptchaScore != null ? (a.recaptchaScore / 100).toFixed(2) : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {total > 50 && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'center' }}>
                    <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                        style={{ padding: '0.375rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
                        Prev
                    </button>
                    <span style={{ padding: '0.375rem', color: '#6b7280' }}>Page {page}</span>
                    <button disabled={answers.length < 50} onClick={() => setPage(page + 1)}
                        style={{ padding: '0.375rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
