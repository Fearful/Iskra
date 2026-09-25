/**
 * Texto de otros usuarios listo para imprimir en una terminal.
 *
 * Los mensajes, nombres y salas llegan de la red: un `ESC [ ...` o un
 * `ESC ] ...` (OSC) en ellos lo interpreta la terminal de quien lee (borrar la
 * pantalla, cambiar el titulo, escribir en el portapapeles, links falsos). Se
 * quitan los caracteres de control (C0, DEL, C1) y los de formato invisibles
 * (p. ej. los que invierten la direccion del texto); los saltos de linea y
 * tabulaciones quedan como espacios.
 */
export function forTerminal(value: unknown): string {
    return String(value ?? '')
        .replace(/[\t\n\r]/g, ' ')
        .replace(/[\p{Cc}\p{Cf}]/gu, '');
}
