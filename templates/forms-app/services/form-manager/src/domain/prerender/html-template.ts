import type { FormField } from '@forms-app/shared';

/**
 * Escapes text for HTML element content and quoted attribute values. Every
 * admin-defined value (title, labels, options, help text...) goes through it:
 * the page is public, so markup in a label would run in every visitor's
 * browser, next to the form's CSRF and reCAPTCHA tokens.
 */
export function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderFieldHtml(field: FormField): string {
    const name = escapeHtml(field.name);
    const requiredAttr = field.required ? ' required' : '';
    const placeholderAttr = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
    const maxLengthAttr = field.maxLength ? ` maxlength="${escapeHtml(field.maxLength)}"` : '';
    const minAttr = field.min !== null ? ` min="${escapeHtml(field.min)}"` : '';
    const maxAttr = field.max !== null ? ` max="${escapeHtml(field.max)}"` : '';

    let inputHtml: string;

    switch (field.fieldType) {
        case 'text':
            inputHtml = `<input type="text" name="${name}" id="${name}"${requiredAttr}${placeholderAttr}${maxLengthAttr} />`;
            break;

        case 'email':
            inputHtml = `<input type="email" name="${name}" id="${name}"${requiredAttr}${placeholderAttr}${maxLengthAttr} />`;
            break;

        case 'number':
            inputHtml = `<input type="number" name="${name}" id="${name}"${requiredAttr}${placeholderAttr}${minAttr}${maxAttr} />`;
            break;

        case 'textarea':
            inputHtml = `<textarea name="${name}" id="${name}"${requiredAttr}${placeholderAttr}${maxLengthAttr}></textarea>`;
            break;

        case 'date':
            inputHtml = `<input type="date" name="${name}" id="${name}"${requiredAttr} />`;
            break;

        case 'select': {
            const options = (field.options ?? [])
                .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
                .join('\n            ');
            inputHtml = `<select name="${name}" id="${name}"${requiredAttr}>
            <option value="">-- Select --</option>
            ${options}
        </select>`;
            break;
        }

        case 'radio': {
            const radios = (field.options ?? [])
                .map(
                    (o) =>
                        `<label><input type="radio" name="${name}" value="${escapeHtml(o.value)}"${requiredAttr} /> ${escapeHtml(o.label)}</label>`,
                )
                .join('\n            ');
            inputHtml = `<div class="radio-group">\n            ${radios}\n        </div>`;
            break;
        }

        case 'checkbox': {
            if (field.options && field.options.length > 0) {
                const checks = field.options
                    .map(
                        (o) =>
                            `<label><input type="checkbox" name="${name}" value="${escapeHtml(o.value)}" /> ${escapeHtml(o.label)}</label>`,
                    )
                    .join('\n            ');
                inputHtml = `<div class="checkbox-group">\n            ${checks}\n        </div>`;
            } else {
                inputHtml = `<label><input type="checkbox" name="${name}" id="${name}"${requiredAttr} /> ${escapeHtml(field.label)}</label>`;
            }
            break;
        }

        default:
            inputHtml = `<input type="text" name="${name}" id="${name}"${requiredAttr} />`;
    }

    const helpHtml = field.helpText ? `\n        <small class="help-text">${escapeHtml(field.helpText)}</small>` : '';

    return `    <div class="form-field" data-field="${name}">
        <label for="${name}">${escapeHtml(field.label)}${field.required ? ' <span class="required">*</span>' : ''}</label>
        ${inputHtml}
        <span class="error-message" id="error-${name}"></span>${helpHtml}
    </div>`;
}

export function generateFormHtml(
    title: string,
    description: string | null,
    fields: FormField[],
    formId: string,
    recaptchaSiteKey: string,
): string {
    const sorted = [...fields].sort((a, b) => a.position - b.position);
    const fieldsHtml = sorted.map(renderFieldHtml).join('\n\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <script src="https://www.google.com/recaptcha/api.js?render=${escapeHtml(encodeURIComponent(recaptchaSiteKey))}"></script>
    <link rel="stylesheet" href="./assets/style.css" />
</head>
<body>
    <main class="form-container">
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}

        <form id="form-${escapeHtml(formId)}" novalidate>
${fieldsHtml}

            <div class="form-actions">
                <button type="submit">Submit</button>
            </div>

            <div id="form-status" class="form-status" hidden></div>
        </form>
    </main>

    <script type="module" src="./main.ts"></script>
</body>
</html>`;
}
