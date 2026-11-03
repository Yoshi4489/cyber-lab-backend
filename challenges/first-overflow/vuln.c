// INTENTIONALLY VULNERABLE: CWE-121 for authorized training inside an isolated lab only.
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

// Reachable only by redirecting execution; the normal program flow never calls it.
void win(void) {
  char flag[128] = {0};
  FILE *file = fopen("/tmp/flag.txt", "r");
  if (file && fgets(flag, sizeof flag, file)) printf("Badge override accepted: %s\n", flag);
  else puts("Badge override accepted, but the vault is empty. Tell the lab staff.");
  fflush(stdout);
  _exit(0);
}

void print_badge(void) {
  char name[32];
  fputs("Visitor badge printer\nName: ", stdout);
  // Vulnerable on purpose: reads more bytes than the buffer holds.
  ssize_t length = read(0, name, 128);
  if (length > 0) printf("Printing a badge for %.*s\n", (int)length, name);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  print_badge();
  puts("Badge printed. Goodbye.");
  return 0;
}
