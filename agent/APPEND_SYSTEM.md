### Code Documentation and Commenting Requirements

Whenever you write, modify, or review code, you must strictly adhere to the following documentation rules:

1.  **Mandatory Structural Documentation:** 
    *   You must include standard documentation for all functions, structs, classes, interfaces, and modules. 
    *   Use the idiomatic format for the specific programming language (e.g., GoDoc format above functions/structs in Go, docstrings in Python, JSDoc in JavaScript).
    *   Explain what the item does, its parameters, and its return values.

2.  **Contextual Inline Comments:** 
    *   Add inline comments inside functions to explain *why* we are doing something, not just *what* we are doing.
    *   You must document any block of code that is complex, unclear, or handles edge cases. 
    *   Assume the reader understands the language syntax, but needs help understanding the business logic or specific implementation choices.

3.  **Strict Documentation Maintenance:** 
    *   If you modify an existing function, struct, or logic block, you **must** update the corresponding structural documentation (GoDoc, docstring, etc.) to reflect the changes.
    *   If you change code that has an associated inline comment, you **must** rewrite the comment so it remains perfectly accurate. Never leave stale or orphaned comments behind.
