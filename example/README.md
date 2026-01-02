# LettaCTL Example Configuration

This folder contains a complete example of how to use LettaCTL to manage Letta AI agents declaratively.

## Quick Start

1. **Set your Letta API URL:**
   ```bash
   export LETTA_BASE_URL=http://localhost:8283
   ```

2. **Deploy the example agents:**
   ```bash
   lettactl apply -f agents.yml
   ```

3. **View your agents:**
   ```bash
   lettactl get agents
   ```

## Folder Structure

```
example/
├── agents.yml              # Main configuration file
├── config/                 # Base system configuration
│   └── base-letta-system.md
├── files/                  # Knowledge files for agents
│   ├── cooking-techniques.md
│   ├── ingredient-substitutions.md
│   ├── seasonal-ingredients.md
│   └── travel-planning-guide.md
├── memory-blocks/          # Agent memory definitions
│   ├── recipe/
│   │   ├── cooking-preferences.md
│   │   └── recipe-history.md
│   ├── travel/
│   │   ├── destination-knowledge.md
│   │   ├── travel-preferences.md
│   │   ├── trip-history.md
│   │   └── user-profile.md
│   ├── shared-archival-policies.md
│   └── shared-guidelines.md
├── prompts/                # System prompt definitions
│   ├── recipe-system-prompt.md
│   └── travel-system-prompt.md
├── tools/                  # Custom Python tools
│   └── recipe_generator.py
└── README.md              # This file
```

## Configuration File Structure

The `agents.yml` file defines your fleet configuration:

### Shared Blocks
Memory blocks that can be reused across multiple agents:
```yaml
shared_blocks:
  - name: shared_guidelines
    description: "General guidelines for all agents"
    limit: 2000
    from_file: "memory-blocks/shared-guidelines.md"
```

### Agents
Each agent configuration includes:
```yaml
agents:
  - name: recipe-assistant
    description: "AI chef assistant"
    llm_config:                                     # Required: should be first
      model: "google_ai/gemini-2.5-pro"
      context_window: 32000
    system_prompt:
      from_file: "prompts/recipe-system-prompt.md"  # Or use 'value:' for inline
    tools:
      - archival_memory_insert
      - archival_memory_search
    memory_blocks:
      - name: cooking_preferences
        description: "User's dietary preferences and skill level"
        limit: 2000
        from_file: "memory-blocks/recipe/cooking-preferences.md"
    folders:
      - name: recipe_knowledge
        files:
          - "files/cooking-techniques.md"
          - "files/ingredient-substitutions.md"
```

## Key Features

### 1. System Prompt Composition
- **Base System Instructions**: Automatically loaded from `config/base-letta-system.md`
- **Custom Prompts**: Your role-specific instructions in `<goals>` tags
- **Automatic Concatenation**: Base + custom prompts combined automatically

### 2. Diff-Based Agent Updates
- **Smart Detection**: Changes to system prompts create new versioned agents
- **Graceful Updates**: Existing agents remain untouched when unchanged
- **Version Naming**: Format: `agent-name__v__20241202-abc123ef`

### 3. Memory Block Versioning
- **Content Hashing**: Automatic versioning based on content changes
- **Shared Blocks**: Reusable memory across multiple agents
- **Smart Discovery**: Auto-loads from `memory-blocks/{name}.md` if no file specified

### 4. Tool Auto-Discovery
- **Pattern Matching**: Use `tools/*` to auto-discover all Python tools
- **Automatic Registration**: Tools uploaded and registered with Letta
- **Reuse Detection**: Existing tools are reused when unchanged

### 5. File Management
- **Folder Creation**: Automatic folder creation and file uploads
- **Glob Support**: Use `files/*` to include entire directories
- **Upload Optimization**: Files only uploaded to new folders

## Common Patterns

### System Prompt Options

**Option 1: File-based prompt**
```yaml
system_prompt:
  from_file: "prompts/my-prompt.md"
```

**Option 2: Inline prompt**
```yaml
system_prompt:
  value: |
    <goals>
    You are a helpful assistant focused on...
    </goals>
```

### Memory Block Options

**Option 1: Explicit file reference**
```yaml
memory_blocks:
  - name: user_prefs
    description: "User preferences"
    limit: 2000
    from_file: "memory-blocks/user-prefs.md"
```

**Option 2: Auto-discovery** (looks for `memory-blocks/{name}.md`)
```yaml
memory_blocks:
  - name: user_prefs
    description: "User preferences"
    limit: 2000
```

### Tool Configuration

**Option 1: Specific tools**
```yaml
tools:
  - archival_memory_insert
  - archival_memory_search
  - my_custom_tool
```

**Option 2: Auto-discovery**
```yaml
tools:
  - tools/*  # Discovers all .py files in tools/
```

## Commands Reference

### Apply Configuration
```bash
# Deploy all agents
lettactl apply -f agents.yml

# Deploy specific agent only
lettactl apply -f agents.yml --agent recipe-assistant

# Dry run (show what would be created)
lettactl apply -f agents.yml --dry-run

# Verbose output
lettactl apply -f agents.yml -v
```

### View Resources
```bash
# List all agents
lettactl get agents

# Get detailed info about an agent
lettactl describe agent recipe-assistant

# Show recent conversations
lettactl logs agent recipe-assistant
```

### Validation
```bash
# Validate configuration file
lettactl validate -f agents.yml
```

### Cleanup
```bash
# Delete an agent (requires --force)
lettactl delete agent recipe-assistant --force
```

## Best Practices

1. **Version Control**: Keep your entire example folder in git
2. **Environment Variables**: Use `.env` files for API configurations
3. **Modular Prompts**: Break complex prompts into focused files
4. **Memory Organization**: Group related memory blocks in subfolders
5. **Tool Testing**: Test tools independently before adding to agents
6. **Incremental Updates**: Make small changes and test frequently

## Troubleshooting

**Agent not updating?**
- Check if system prompt content actually changed
- Use `-v` flag to see what's being detected

**Memory block not found?**
- Ensure file exists at `memory-blocks/{name}.md`
- Check file path in `from_file` field

**Tool not working?**
- Verify Python syntax in tool file
- Check tool dependencies are available in Letta environment

**Files not uploading?**
- Confirm file paths are correct relative to config file
- Check if folder already exists (files only upload to new folders)

This example demonstrates the full capabilities of LettaCTL for managing sophisticated AI agent fleets declaratively.