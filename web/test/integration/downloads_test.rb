require "test_helper"

# The download page and the stable links to each installer.
class DownloadsTest < ActionDispatch::IntegrationTest
  MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
  WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  OLD = "Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko"

  test "anyone can open the page, and it offers this computer's version first" do
    get "/download", headers: { "User-Agent" => MAC }
    assert_response :success
    assert_select "a.dl-main[href=?]", "/download/mac", text: "Download for Mac"

    get "/download", headers: { "User-Agent" => WINDOWS }
    assert_select "a.dl-main[href=?]", "/download/windows", text: "Download for Windows"
  end

  test "a phone is told to use a computer" do
    get "/download", headers: { "User-Agent" => PHONE }
    assert_response :success
    assert_select "a.dl-main", false
    assert_select ".dl-phone"
  end

  test "an old browser still gets the page" do
    get "/download", headers: { "User-Agent" => OLD }
    assert_response :success
  end

  test "each link goes to the newest installer" do
    get "/download/mac"
    assert_redirected_to Rails.configuration.x.desktop_downloads[:mac]
    assert_match %r{/Sondage-mac\.dmg\z}, response.location
    get "/download/windows"
    assert_match %r{/Sondage-windows\.exe\z}, response.location
  end

  test "an unknown platform is not found" do
    get "/download/amiga"
    assert_response :not_found
  end
end
