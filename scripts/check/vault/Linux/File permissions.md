# File permissions

Every file has an owner, a group, and everyone else. Each gets read (4), write (2) and execute (1), added up: `chmod 754 file` gives the owner rwx, the group r-x, and others r--.

For a directory, read lists its files, write creates and deletes them, and execute lets you enter it.
