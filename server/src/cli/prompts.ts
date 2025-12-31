import * as readline from "readline";

/**
 * Create a readline interface for prompting
 */
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Prompt for text input
 */
export async function prompt(message: string, defaultValue?: string): Promise<string> {
  const rl = createInterface();
  const displayDefault = defaultValue ? ` (${defaultValue})` : "";

  return new Promise((resolve) => {
    rl.question(`${message}${displayDefault}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

/**
 * Prompt for required text input (will keep asking until provided)
 */
export async function promptRequired(message: string): Promise<string> {
  let value = "";
  while (!value) {
    value = await prompt(message);
    if (!value) {
      console.log("This field is required. Please enter a value.");
    }
  }
  return value;
}

/**
 * Prompt for confirmation (y/n)
 */
export async function confirm(message: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const rl = createInterface();

  return new Promise((resolve) => {
    rl.question(`${message} (${hint}): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === "") {
        resolve(defaultYes);
      } else {
        resolve(normalized === "y" || normalized === "yes");
      }
    });
  });
}

/**
 * Display options and prompt for selection
 */
export async function select<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; description?: string }>
): Promise<T> {
  console.log(`\n${message}\n`);

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const desc = opt.description ? ` - ${opt.description}` : "";
    console.log(`  ${i + 1}. ${opt.label}${desc}`);
  }

  console.log("");

  const rl = createInterface();

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question("Enter number: ", (answer) => {
        const num = parseInt(answer.trim(), 10);
        if (num >= 1 && num <= options.length) {
          rl.close();
          resolve(options[num - 1].value);
        } else {
          console.log(`Please enter a number between 1 and ${options.length}`);
          askQuestion();
        }
      });
    };
    askQuestion();
  });
}

/**
 * Print a styled header
 */
export function printHeader(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60) + "\n");
}

/**
 * Print a styled section
 */
export function printSection(title: string) {
  console.log(`\n--- ${title} ---\n`);
}

/**
 * Print a warning box
 */
export function printWarning(message: string) {
  const border = "=".repeat(60);
  console.log(`\n${border}`);
  console.log("  WARNING: " + message);
  console.log(border + "\n");
}

/**
 * Print a success message
 */
export function printSuccess(message: string) {
  console.log(`\n[SUCCESS] ${message}\n`);
}

/**
 * Print an error message
 */
export function printError(message: string) {
  console.error(`\n[ERROR] ${message}\n`);
}

/**
 * Print a key-value pair
 */
export function printKeyValue(key: string, value: string) {
  console.log(`  ${key}: ${value}`);
}

/**
 * Print a list of next steps
 */
export function printNextSteps(steps: string[]) {
  console.log("\nNext steps:");
  for (let i = 0; i < steps.length; i++) {
    console.log(`  ${i + 1}. ${steps[i]}`);
  }
  console.log("");
}
