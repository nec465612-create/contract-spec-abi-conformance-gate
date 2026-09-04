import json
import cloudpickle


NONCE = "0123456789abcdef0123456789abcdef"


def param(type_name, name=""):
    return {"name": name, "type": type_name}


def function(name="check", inputs=None, outputs=None, mutability="view"):
    return {
        "type": "function",
        "name": name,
        "inputs": inputs or [],
        "outputs": outputs or [],
        "stateMutability": mutability,
    }


def base(requirements=None, abi=None):
    return {
        "requirements": requirements
        or [{"id": "read", "text": "Expose a read operation", "polarity": "REQUIRED"}],
        "abi": abi or [function()],
    }


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def deploy(direct_vm, direct_deploy, sender):
    direct_vm.sender = sender
    direct_vm.strict_mocks = True
    return direct_deploy("contracts/main.py")


def create(contract, payload=None, nonce=NONCE, parent=0):
    return contract.create_case(nonce, encoded(payload or base()), parent)


def record(contract, case_id=1):
    return json.loads(contract.get_case(case_id))


def test_create_views_history_replay_and_nonce_conflict(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    case_id = create(contract)
    assert int(case_id) == 1
    assert int(contract.get_count()) == 1
    assert int(contract.get_id_by_nonce(direct_alice, NONCE)) == 1
    assert json.loads(contract.list_cases(1, 4)) == {"ids": ["1"], "next": "0"}
    assert json.loads(contract.list_actor(direct_alice, 0, 4)) == {"ids": ["1"], "next": "0"}
    first = record(contract)
    assert first["phase"] == "BASE_DRAFT"
    assert first["revision"] == "1"
    assert json.loads(contract.get_version(1, 1)) == first
    assert int(create(contract)) == 1
    assert int(contract.get_count()) == 1

    changed = base(requirements=[{"id": "write", "text": "Expose a write", "polarity": "REQUIRED"}])
    with direct_vm.expect_revert("NONCE_CONFLICT"):
        create(contract, changed)
    assert record(contract) == first


def test_draft_authority_revision_freeze_and_no_write(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    create(contract)
    before = contract.get_case(1)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("UNAUTHORIZED"):
        contract.replace_base(1, encoded(base()), 1)
    assert contract.get_case(1) == before

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("STALE_REVISION"):
        contract.freeze_case(1, 2)
    assert contract.get_case(1) == before

    contract.replace_base(1, encoded(base()), 1)
    contract.freeze_case(1, 2)
    frozen = record(contract)
    assert frozen["phase"] == "FROZEN"
    assert frozen["base_locked"] is True
    assert frozen["response_locked"] is True
    assert frozen["revision"] == "3"
    assert json.loads(contract.get_version(1, 2))["phase"] == "BASE_DRAFT"

    with direct_vm.expect_revert("BAD_PHASE"):
        contract.replace_base(1, encoded(base()), 3)


def test_duplicate_json_keys_and_callable_identity_reject_before_write(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    duplicate_key = '{"requirements":[],"requirements":[],"abi":[]}'
    with direct_vm.expect_revert("DUPLICATE_KEY"):
        contract.create_case(NONCE, duplicate_key, 0)

    cases = [
        [function(inputs=[param("uint")]), function(inputs=[param("uint256")])],
        [function(outputs=[param("uint256")]), function(outputs=[param("bool")])],
        [function(mutability="view"), function(mutability="pure")],
    ]
    for index, abi in enumerate(cases):
        nonce = f"{index + 1:032x}"
        with direct_vm.expect_revert("DUPLICATE_CALLABLE"):
            contract.create_case(nonce, encoded(base(abi=abi)), 0)
    assert int(contract.get_count()) == 0


def test_distinct_overloads_ignored_entries_and_nested_tuple_arrays(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    tuple_param = {
        "name": "items",
        "type": "tuple[][2]",
        "components": [param("uint"), param("address")],
    }
    abi = [
        {"type": "constructor", "inputs": [], "stateMutability": "nonpayable"},
        {"type": "event", "name": "seen", "inputs": [{"name": "id", "type": "uint256", "indexed": True}], "anonymous": False},
        {"type": "error", "name": "bad", "inputs": []},
        {"type": "fallback", "stateMutability": "nonpayable"},
        {"type": "receive", "stateMutability": "payable"},
        function(inputs=[tuple_param]),
        function(inputs=[param("address")]),
    ]
    assert int(create(contract, base(abi=abi))) == 1

    malformed = base(abi=[function(inputs=[{"name": "x", "type": "uint256", "components": [param("address")]}])])
    with direct_vm.expect_revert("BAD_SCHEMA"):
        contract.create_case("f" * 32, encoded(malformed), 0)


def test_input_caps_controls_extra_keys_and_bool_as_integer(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    extra = base()
    extra["unexpected"] = True
    with direct_vm.expect_revert("BAD_SCHEMA"):
        create(contract, extra)
    controls = base(requirements=[{"id": "read", "text": "bad\u0000text", "polarity": "REQUIRED"}])
    with direct_vm.expect_revert("BAD_TEXT"):
        contract.create_case("1" * 32, encoded(controls), 0)
    with direct_vm.expect_revert("CAPACITY"):
        contract.create_case("2" * 32, encoded(base(requirements=[{"id": "read", "text": "x" * 9000, "polarity": "REQUIRED"}])), 0)
    with direct_vm.expect_revert("BAD_INTEGER"):
        contract.list_cases(True, 1)


def test_evaluate_conformant_and_validator_disagreement(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    create(contract)
    contract.freeze_case(1, 1)
    direct_vm.mock_llm("BEGIN_UNTRUSTED_JSON", '{"v":1,"labels":["IMPLEMENTS"]}')
    contract.evaluate_case(1, 2)
    final = record(contract)
    assert final["phase"] == "DONE"
    assert final["outcome"] == "CONFORMANT"
    assert final["accepted_attempts"] == 1
    assert final["revision"] == "3"
    assert direct_vm.run_validator() is True
    _, leader, validator = direct_vm._captured_validators[-1]
    cloudpickle.dumps(leader)
    cloudpickle.dumps(validator)

    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN_UNTRUSTED_JSON", '{"v":1,"labels":["NONE"]}')
    assert direct_vm.run_validator() is False
    assert record(contract) == final


def test_reducer_precedence_and_polarity_shape(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    requirements = [
        {"id": "need", "text": "Must expose read", "polarity": "REQUIRED"},
        {"id": "ban", "text": "Must not expose write", "polarity": "FORBIDDEN"},
    ]
    create(contract, base(requirements=requirements))
    contract.freeze_case(1, 1)
    direct_vm.mock_llm("BEGIN_UNTRUSTED_JSON", '{"v":1,"labels":["NONE","VIOLATES"]}')
    contract.evaluate_case(1, 2)
    assert record(contract)["outcome"] == "FORBIDDEN_SURFACE"

    contract.create_case("f" * 32, encoded(base()), 0)
    contract.freeze_case(2, 1)
    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN_UNTRUSTED_JSON", '{"v":1,"labels":["VIOLATES"]}')
    before = contract.get_case(2)
    with direct_vm.expect_revert("MALFORMED_RESULT"):
        contract.evaluate_case(2, 2)
    assert contract.get_case(2) == before


def test_unresolved_retry_cooldown_and_exhaustion(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    create(contract)
    contract.freeze_case(1, 1)
    direct_vm.mock_llm("BEGIN_UNTRUSTED_JSON", '{"v":1,"labels":["UNKNOWN"]}')
    contract.evaluate_case(1, 2)
    first = record(contract)
    assert first["phase"] == "UNRESOLVED"
    assert first["accepted_attempts"] == 1

    with direct_vm.expect_revert("COOLDOWN"):
        contract.retry_case(1, 3)
    direct_vm.warp("2099-01-01T00:00:00+00:00")
    contract.retry_case(1, 3)
    direct_vm.warp("2099-01-01T00:02:00+00:00")
    contract.retry_case(1, 4)
    exhausted = record(contract)
    assert exhausted["phase"] == "EXHAUSTED"
    assert exhausted["accepted_attempts"] == 3
    with direct_vm.expect_revert("BAD_PHASE"):
        contract.retry_case(1, 5)


def test_parent_requires_terminal_same_actor_and_indexes_child(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    create(contract)
    with direct_vm.expect_revert("BAD_PARENT"):
        contract.create_case("1" * 32, encoded(base()), 1)
    contract.freeze_case(1, 1)
    direct_vm.mock_llm("BEGIN_UNTRUSTED_JSON", '{"v":1,"labels":["IMPLEMENTS"]}')
    contract.evaluate_case(1, 2)
    child = contract.create_case("1" * 32, encoded(base()), 1)
    assert int(child) == 2
    assert json.loads(contract.list_children(1, 0, 4)) == {"ids": ["2"], "next": "0"}

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("BAD_PARENT"):
        contract.create_case("2" * 32, encoded(base()), 1)


def test_missing_views_and_bad_pages(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    assert contract.get_case(0) == "null"
    assert contract.get_case(1) == "null"
    assert contract.get_version(1, 1) == "null"
    assert json.loads(contract.list_actor(direct_alice, 0, 4)) == {"ids": [], "next": "0"}
    with direct_vm.expect_revert("BAD_INTEGER"):
        contract.list_cases(0, 1)
    with direct_vm.expect_revert("BAD_INTEGER"):
        contract.list_cases(1, 5)
