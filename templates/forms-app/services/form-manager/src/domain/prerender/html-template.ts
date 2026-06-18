import type { FormField } from '@forms-app/shared';

function renderFieldHtml(field: FormField): string {
    const requiredAttr = field.required ? ' required' : '';
    const placeholderAttr = field.placeholder ? ` placeholder="${field.placeholder}"` : '';
    const maxLengthAttr = field.maxLength ? ` maxlength="${field.maxLength}"` : '';
    const minAttr = field.min !== null ? ` min="${field.min}"` : '';
    const maxAttr = field.max !== null ? ` max="${field.max}"` : '';

    let inputHtml: string;

    switch (field.fieldType) {
        case 'text':
            inputHtml = `<input type="text" name="${field.name}" id="${field.name}"${requiredAttr}${placeholderAttr}${maxLengthAttr} />`;
            break;

        case 'email':
            inputHtml = `<input type="email" name="${field.name}" id="${field.name}"${requiredAttr}${placeholderAttr}${maxLengthAttr} />`;
            break;

        case 'number':
            inputHtml = `<input type="number" name="${field.name}" id="${field.name}"${requiredAttr}${placeholderAttr}${minAttr}${maxAttr} />`;
            break;

        case 'textarea':
            inputHtml = `<textarea name="${field.name}" id="${field.name}"${requiredAttr}${placeholderAttr}${maxLengthAttr}></textarea>`;
            break;

        case 'date':
            inputHtml = `<input type="date" name="${field.name}" id="${field.name}"${requiredAttr} />`;
            break;

        case 'select': {
            const options = (field.options ?? [])
                .map((o) => `<option value="${o.value}">${o.label}</option>`)
                .join('\n            ');
            inputHtml = `<select name="${field.name}" id="${field.name}"${requiredAttr}>
            <option value="">-- Select --</option>
            ${options}
        </select>`;
            break;
        }

        case 'radio': {
            const radios = (field.options ?? [])
                .map(
                    (o) =>
                        `<label><input type="radio" name="${field.name}" value="${o.value}"${requiredAttr} /> ${o.label}</label>`,
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
                            `<label><input type="checkbox" name="${field.name}" value="${o.value}" /> ${o.label}</label>`,
                    )
                    .join('\n            ');
                inputHtml = `<div class="checkbox-group">\n            ${checks}\n        </div>`;
            } else {
                inputHtml = `<label><input type="checkbox" name="${field.name}" id="${field.name}"${requiredAttr} /> ${field.label}</label>`;
            }
            break;
        }

        default:
            inputHtml = `<input type="text" name="${field.name}" id="${field.name}"${requiredAttr} />`;
    }

    const helpHtml = field.helpText ? `\n        <small class="help-text">${field.helpText}</small>` : '';

    return `    <div class="form-field" data-field="${field.name}">
        <label for="${field.name}">${field.label}${field.required ? ' <span class="required">*</span>' : ''}</label>
        ${inputHtml}
        <span class="error-message" id="error-${field.name}"></span>${helpHtml}
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
    <title>${title}</title>
    <script src="https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}"></script>
    <link rel="stylesheet" href="./assets/style.css" />
</head>
<body>
    <main class="form-container">
        <h1>${title}</h1>
        ${description ? `<p class="description">${description}</p>` : ''}

        <form id="form-${formId}" novalidate>
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
