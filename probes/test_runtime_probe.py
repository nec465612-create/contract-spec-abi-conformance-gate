import cloudpickle


def test_runtime_probe_storage_abi_consensus_and_pickling(
    direct_vm, direct_deploy, direct_alice
):
    direct_vm.strict_mocks = True
    direct_vm.check_pickling = True
    direct_vm.mock_llm("BEGIN_UNTRUSTED_TEXT", '{"label":"YES"}')

    contract = direct_deploy("probes/runtime_probe.py")
    assert int(contract.get_count()) == 0

    record_id = contract.probe_consensus(direct_alice, "interface requirement")
    assert int(record_id) == 1
    assert contract.get_record(record_id) == '{"label":"YES"}'
    assert int(contract.get_owner_record(direct_alice)) == 1
    assert direct_vm.run_validator() is True

    _, leader, validator = direct_vm._captured_validators[-1]
    cloudpickle.dumps(leader)
    cloudpickle.dumps(validator)


def test_runtime_probe_validator_rejects_different_decision(
    direct_vm, direct_deploy, direct_alice
):
    direct_vm.mock_llm("BEGIN_UNTRUSTED_TEXT", '{"label":"YES"}')
    contract = direct_deploy("probes/runtime_probe.py")
    contract.probe_consensus(direct_alice, "interface requirement")

    direct_vm.clear_mocks()
    direct_vm.mock_llm("BEGIN_UNTRUSTED_TEXT", '{"label":"NO"}')
    assert direct_vm.run_validator() is False
