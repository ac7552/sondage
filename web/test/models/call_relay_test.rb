require "test_helper"

class CallRelayTest < ActiveSupport::TestCase
  def with_env(vars)
    old = vars.keys.to_h { |k| [ k, ENV[k] ] }
    vars.each { |k, v| ENV[k] = v }
    yield
  ensure
    old.each { |k, v| ENV[k] = v }
  end

  test "relay passwords follow coturn's shared-secret scheme and expire" do
    user = User.new(id: 7, name: "x", role: "historian")
    now = Time.utc(2026, 11, 4, 12)
    with_env("TURN_URLS" => "turn:relay.test:3478", "TURN_SECRET" => "s3cret", "TURN_ONLY" => nil) do
      turn = CallRelay.ice_servers_for(user, now:).find { |s| s[:username] }
      assert_equal "#{(now + 12.hours).to_i}:7", turn[:username]
      assert_equal Base64.strict_encode64(OpenSSL::HMAC.digest("SHA1", "s3cret", turn[:username])), turn[:credential]
      assert_equal [ "turn:relay.test:3478" ], turn[:urls]
    end
  end

  test "relay-only drops STUN, and only applies when a relay exists" do
    user = User.new(id: 1, name: "x", role: "fellow")
    with_env("TURN_URLS" => "turn:relay.test:3478", "TURN_SECRET" => "s", "TURN_ONLY" => "1") do
      assert CallRelay.relay_only?
      assert(CallRelay.ice_servers_for(user).all? { |s| s[:username] })
    end
    with_env("TURN_URLS" => nil, "TURN_URL" => nil, "TURN_ONLY" => "1") do
      refute CallRelay.relay_only?
      assert_equal [ { urls: [ "stun:stun.l.google.com:19302" ] } ], CallRelay.ice_servers_for(user)
    end
  end
end
