import sys

if __name__ == "__main__":
    # A PDF child has its own stdin/stdout protocol and never initializes the API
    # or its parent-lifetime watcher. The same entry point works when frozen.
    if sys.argv[1:] == ["--pdf-worker"]:
        from atlas.pdf_worker import main
    else:
        from atlas.server import main
    main()
