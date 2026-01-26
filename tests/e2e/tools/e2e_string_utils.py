def e2e_string_utils(action: str, text: str) -> str:
    """
    String utility tool for e2e testing.

    Args:
        action: The action to perform (reverse, uppercase, lowercase, length)
        text: The text to process

    Returns:
        The processed text or result
    """
    if action == "reverse":
        return text[::-1]
    elif action == "uppercase":
        return text.upper()
    elif action == "lowercase":
        return text.lower()
    elif action == "length":
        return str(len(text))
    else:
        raise ValueError(f"Unknown action: {action}")
