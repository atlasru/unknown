import pytest
from atlas.store import Store

@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path / "workspace")
    yield value
    value.close()

@pytest.fixture
def case(store):
    return store.create_case("TEST / 001", "Test investigation")["id"]
