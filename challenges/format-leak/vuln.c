// INTENTIONALLY VULNERABLE: CWE-134 for authorized training inside an isolated lab only.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);

  char secret[128] = {0};
  FILE *file = fopen("/tmp/flag.txt", "r");
  if (file && fgets(secret, sizeof secret, file)) secret[strcspn(secret, "\n")] = 0;
  else strcpy(secret, "the-vault-is-empty-tell-lab-staff");
  // A pointer to the secret stays on the stack, within reach of a format-string read.
  volatile char *held = secret;
  (void)held;

  char line[256];
  fputs("Feedback terminal. Type a message; type quit to exit.\n", stdout);
  while (fgets(line, sizeof line, stdin)) {
    line[strcspn(line, "\n")] = 0;
    if (strcmp(line, "quit") == 0) break;
    fputs("You said: ", stdout);
    // Vulnerable on purpose: user input is used as the printf format string.
    printf(line);
    fputc('\n', stdout);
  }
  return 0;
}
