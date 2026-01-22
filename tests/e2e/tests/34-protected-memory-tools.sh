#!/bin/bash
# Test: Protected memory and file tools are never removed (#130, #137)
# memory_insert, memory_replace, memory_rethink, memory, open_files, grep_files should always be preserved
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

AGENT="e2e-memory-tools-test"
section "Test: Protected Memory and File Tools (#130, #137)"
preflight_check
mkdir -p "$LOG_DIR"

delete_agent_if_exists "$AGENT"

# Create agent with all memory and file tools
info "Creating agent with memory and file tools..."
$CLI apply -f "$FIXTURES/fleet-memory-tools-test.yml" > $OUT 2>&1
agent_exists "$AGENT" && pass "Agent created" || fail "Agent not created"

# Verify all memory tools are attached
$CLI get tools --agent "$AGENT" > $OUT 2>&1
output_contains "memory_insert" && pass "memory_insert attached" || fail "memory_insert missing"
output_contains "memory_replace" && pass "memory_replace attached" || fail "memory_replace missing"
output_contains "memory_rethink" && pass "memory_rethink attached" || fail "memory_rethink missing"
output_contains "memory" && pass "memory (omni) attached" || fail "memory (omni) missing"
# File tools (#137)
output_contains "open_files" && pass "open_files attached" || fail "open_files missing"
output_contains "grep_files" && pass "grep_files attached" || fail "grep_files missing"

# Apply reduced config that doesn't include memory/file tools
info "Applying config WITHOUT memory/file tools listed..."
$CLI apply -f "$FIXTURES/fleet-memory-tools-reduced.yml" > $OUT 2>&1

# All protected tools should remain (even without --force)
$CLI get tools --agent "$AGENT" > $OUT 2>&1
output_contains "memory_insert" && pass "memory_insert preserved" || fail "memory_insert incorrectly removed"
output_contains "memory_replace" && pass "memory_replace preserved" || fail "memory_replace incorrectly removed"
output_contains "memory_rethink" && pass "memory_rethink preserved" || fail "memory_rethink incorrectly removed"
output_contains "memory" && pass "memory (omni) preserved" || fail "memory (omni) incorrectly removed"
output_contains "conversation_search" && pass "conversation_search preserved" || fail "conversation_search incorrectly removed"
# File tools (#137)
output_contains "open_files" && pass "open_files preserved" || fail "open_files incorrectly removed"
output_contains "grep_files" && pass "grep_files preserved" || fail "grep_files incorrectly removed"

# With --force: ALL protected tools should STILL stay
info "Applying config with --force..."
$CLI apply -f "$FIXTURES/fleet-memory-tools-reduced.yml" --force > $OUT 2>&1

$CLI get tools --agent "$AGENT" > $OUT 2>&1
output_contains "memory_insert" && pass "memory_insert preserved with --force" || fail "memory_insert removed with --force"
output_contains "memory_replace" && pass "memory_replace preserved with --force" || fail "memory_replace removed with --force"
output_contains "memory_rethink" && pass "memory_rethink preserved with --force" || fail "memory_rethink removed with --force"
output_contains "memory" && pass "memory (omni) preserved with --force" || fail "memory (omni) removed with --force"
output_contains "conversation_search" && pass "conversation_search preserved with --force" || fail "conversation_search removed with --force"
# File tools with --force (#137)
output_contains "open_files" && pass "open_files preserved with --force" || fail "open_files removed with --force"
output_contains "grep_files" && pass "grep_files preserved with --force" || fail "grep_files removed with --force"

delete_agent_if_exists "$AGENT"
print_summary
