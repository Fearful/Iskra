/**
 * Generates the vanilla JS/TS runtime code for a prerendered form.
 * This code is bundled by Vite into the static form page.
 */
export function generateFormRuntime(
    formId: string,
    spaceSlug: string,
    formSlug: string,
    recaptchaSiteKey: string,
): string {
    return `import { formSchema } from 'virtual:form-validation/${formId}';

const form = document.getElementById('form-${formId}');
const statusEl = document.getElementById('form-status');

function showFieldError(fieldName, message) {
    const errorEl = document.getElementById('error-' + fieldName);
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
    const fieldEl = document.querySelector('[name="' + fieldName + '"]');
    if (fieldEl) fieldEl.classList.add('field-error');
}

function clearErrors() {
    document.querySelectorAll('.error-message').forEach(el => {
        el.textContent = '';
        el.style.display = 'none';
    });
    document.querySelectorAll('.field-error').forEach(el => {
        el.classList.remove('field-error');
    });
}

function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.className = 'form-status ' + (isError ? 'error' : 'success');
    statusEl.hidden = false;
}

function getFormData() {
    const fd = new FormData(form);
    const data = {};
    for (const [key, value] of fd.entries()) {
        if (data[key] !== undefined) {
            if (!Array.isArray(data[key])) data[key] = [data[key]];
            data[key].push(value);
        } else {
            data[key] = value;
        }
    }
    // Convert number fields
    form.querySelectorAll('input[type="number"]').forEach(el => {
        if (data[el.name] !== undefined && data[el.name] !== '') {
            data[el.name] = Number(data[el.name]);
        }
    });
    // Convert checkbox single (no value attr) to boolean
    form.querySelectorAll('input[type="checkbox"]:not([value])').forEach(el => {
        data[el.name] = el.checked;
    });
    return data;
}

async function getCsrfToken() {
    const res = await fetch('/formularios/api/csrf-token', { credentials: 'include' });
    const json = await res.json();
    return json.token;
}

async function getRecaptchaToken() {
    return new Promise((resolve) => {
        grecaptcha.ready(() => {
            grecaptcha.execute('${recaptchaSiteKey}', { action: 'submit' }).then(resolve);
        });
    });
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const data = getFormData();

    // Client-side validation with Zod
    const result = formSchema.safeParse(data);
    if (!result.success) {
        for (const issue of result.error.issues) {
            const fieldName = issue.path[0];
            if (fieldName) showFieldError(String(fieldName), issue.message);
        }
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
        const [csrfToken, recaptchaToken] = await Promise.all([
            getCsrfToken(),
            getRecaptchaToken(),
        ]);

        const res = await fetch('/formularios/api/submit/${spaceSlug}/${formSlug}', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                data: result.data,
                recaptchaToken,
            }),
        });

        if (res.ok) {
            showStatus('Form submitted successfully!', false);
            form.reset();
        } else {
            const err = await res.json().catch(() => ({}));
            if (err.errors) {
                for (const [field, msg] of Object.entries(err.errors)) {
                    showFieldError(field, msg);
                }
            } else {
                showStatus(err.error || 'Submission failed. Please try again.', true);
            }
        }
    } catch (err) {
        showStatus('Network error. Please check your connection and try again.', true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
    }
});
`;
}
