export interface MailingListContact {
  email: string;
  name: string | null;
}

export interface ParsedMailingList {
  contacts: MailingListContact[];
  /** Non-empty rows that did not contain a usable address. */
  invalid: number;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Pick the column separator from the first row; lists are usually comma or tab separated. */
function detectDelimiter(line: string) {
  if (line.includes("\t")) return "\t";
  const semicolons = (line.match(/;/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

/** Split one CSV/TSV row, honouring quoted cells and doubled quotes. */
function splitRow(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Parse an uploaded mailing list. Accepts CSV, TSV or one-address-per-line
 * files, with or without a header, and looks for an address in any column
 * (so both `email,name` and `name,email` work). Addresses are lowercased and
 * deduplicated.
 */
export function parseMailingList(text: string): ParsedMailingList {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const delimiter = detectDelimiter(lines[0] ?? "");
  const contacts: MailingListContact[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let headerChecked = false;

  for (const line of lines) {
    const cells = splitRow(line, delimiter);

    if (!headerChecked) {
      headerChecked = true;
      const header = cells.some((cell) => /^(e-?mail|email address)$/i.test(cell));
      if (header && !cells.some((cell) => EMAIL_PATTERN.test(cell))) continue;
    }

    let emailIndex = -1;
    let email: string | null = null;
    for (let i = 0; i < cells.length; i++) {
      const match = cells[i].match(EMAIL_PATTERN);
      if (match) {
        email = match[0].toLowerCase();
        emailIndex = i;
        break;
      }
    }
    if (!email || email.length > 254) {
      invalid++;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const name = cells.find((cell, i) => i !== emailIndex && cell && !EMAIL_PATTERN.test(cell)) ?? null;
    contacts.push({ email, name });
  }

  return { contacts, invalid };
}
